//! Reserve compressed archive bytes before opening or extending a download.
//! Unused credit is returned on drop. A crashed worker leaves a conservative charge.
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    sync::Arc,
};

const BLOCK: u64 = 8 * 1024 * 1024;
const EXHAUSTED: &str = "archive bandwidth budget exhausted; try again later";

#[derive(Default, Clone)]
pub struct Policy {
    dir: Option<PathBuf>,
    pub tracked: Vec<(String, String, String)>,
}

impl Policy {
    pub fn from_env() -> anyhow::Result<Self> {
        let dir = std::env::var_os("ARCHIVE_BUDGET_DIR").map(PathBuf::from);
        let mut tracked = vec![];
        for entry in std::env::var("SLOC_TRACKED_REPOS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let (kind, slug) = entry
                .split_once(':')
                .ok_or_else(|| anyhow::anyhow!("expected kind:owner/repo"))?;
            let (owner, repo) = slug
                .split_once('/')
                .ok_or_else(|| anyhow::anyhow!("expected owner/repo"))?;
            anyhow::ensure!(
                matches!(kind, "forward" | "repair" | "backfill")
                    && !owner.is_empty()
                    && !repo.is_empty()
                    && !repo.contains('/'),
                "invalid SLOC_TRACKED_REPOS entry"
            );
            tracked.push((kind.to_owned(), owner.to_owned(), repo.to_owned()));
        }
        anyhow::ensure!(
            tracked.is_empty() || dir.is_some(),
            "automatic sampling requires an archive budget"
        );
        Ok(Self { dir, tracked })
    }

    pub fn reserve(&self, kind: &'static str) -> io::Result<Option<Credit>> {
        let Some(dir) = &self.dir else {
            return Ok(None);
        };
        let mut credit = Credit {
            dir: dir.clone(),
            kind,
            day: Utc::now().date_naive(),
            left: 0,
            epoch: 0,
        };
        credit.extend()?;
        Ok(Some(credit))
    }
}

#[derive(Deserialize)]
struct Meter {
    timestamp: i64,
    remaining: u64,
    background_daily: u64,
    archive_daily: u64,
    archive_monthly: u64,
}

#[derive(Default, Deserialize, Serialize)]
struct Ledger {
    days: BTreeMap<NaiveDate, BTreeMap<String, u64>>,
    #[serde(default)]
    deferred: BTreeMap<NaiveDate, BTreeMap<String, u64>>,
    epoch: i64,
    issued: u64,
}

fn update<T>(
    dir: &Path,
    day: NaiveDate,
    f: impl FnOnce(&mut Ledger) -> io::Result<T>,
) -> io::Result<T> {
    let dir = dir.join("ledger");
    let lock = File::options()
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("lock"))?;
    lock.lock()?;
    let path = dir.join(day.format("%Y-%m.json").to_string());
    let mut ledger = match fs::read(&path) {
        Ok(data) => serde_json::from_slice(&data)?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ledger::default(),
        Err(e) => return Err(e),
    };
    let result = f(&mut ledger)?;
    let mut temp = tempfile::NamedTempFile::new_in(&dir)?;
    serde_json::to_writer(&mut temp, &ledger)?;
    temp.as_file().sync_all()?;
    temp.persist(path)?;
    File::open(dir)?.sync_all()?;
    Ok(result)
}

pub struct Credit {
    dir: PathBuf,
    kind: &'static str,
    day: NaiveDate,
    left: u64,
    epoch: i64,
}

impl Credit {
    fn extend(&mut self) -> io::Result<()> {
        let now = Utc::now();
        self.day = now.date_naive();
        let (bytes, epoch) = update(&self.dir, self.day, |l| {
            let meter: Meter = serde_json::from_slice(&fs::read(self.dir.join("meter.json"))?)?;
            if !(0..=120).contains(&(now.timestamp() - meter.timestamp)) {
                return Err(io::Error::other("host bandwidth meter is stale"));
            }
            if l.epoch != meter.timestamp {
                l.epoch = meter.timestamp;
                l.issued = 0;
            }
            let month: u64 = l.days.values().flat_map(|s| s.values()).sum();
            let today = l.days.entry(self.day).or_default();
            let daily: u64 = today.values().sum();
            let mut bytes = BLOCK
                .min(meter.archive_daily.saturating_sub(daily))
                .min(meter.archive_monthly.saturating_sub(month))
                .min(meter.remaining.saturating_sub(l.issued));
            if self.kind != "interactive" {
                let background = daily - today.get("interactive").copied().unwrap_or_default();
                bytes = bytes.min(meter.background_daily.saturating_sub(background));
            }
            if bytes == 0 {
                *l.deferred
                    .entry(self.day)
                    .or_default()
                    .entry(self.kind.to_owned())
                    .or_default() += 1;
                return Ok((0, meter.timestamp));
            }
            *today.entry(self.kind.to_owned()).or_default() += bytes;
            l.issued += bytes;
            Ok((bytes, meter.timestamp))
        })?;
        if bytes == 0 {
            return Err(io::Error::other(EXHAUSTED));
        }
        self.left = bytes;
        self.epoch = epoch;
        Ok(())
    }
}

impl Drop for Credit {
    fn drop(&mut self) {
        if self.left == 0 {
            return;
        }
        if let Err(error) = update(&self.dir, self.day, |l| {
            let used = l
                .days
                .get_mut(&self.day)
                .and_then(|s| s.get_mut(self.kind))
                .ok_or_else(|| io::Error::other("missing archive reservation"))?;
            *used = used
                .checked_sub(self.left)
                .ok_or_else(|| io::Error::other("invalid archive reservation"))?;
            if l.epoch == self.epoch {
                l.issued = l.issued.saturating_sub(self.left);
            }
            Ok(())
        }) {
            tracing::error!(%error, "could not refund unused archive credit");
        }
    }
}

pub struct MeteredReader {
    pub archive: Box<dyn Read + Send>,
    pub credit: Credit,
    pub denied: Arc<std::sync::atomic::AtomicBool>,
}
impl Read for MeteredReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        if self.credit.left == 0 {
            self.credit.extend().inspect_err(|_| {
                self.denied
                    .store(true, std::sync::atomic::Ordering::Relaxed)
            })?;
        }
        let limit = buf.len().min(self.credit.left as usize);
        let n = self.archive.read(&mut buf[..limit])?;
        self.credit.left -= n as u64;
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_credit_restart_failure_and_background_limits() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir(tmp.path().join("ledger")).unwrap();
        let meter = serde_json::json!({"timestamp":Utc::now().timestamp(),"remaining":11,"archive_daily":10,"archive_monthly":12,"background_daily":3});
        fs::write(tmp.path().join("meter.json"), meter.to_string()).unwrap();
        let p = Policy {
            dir: Some(tmp.path().into()),
            tracked: vec![],
        };
        let mut bg = p.reserve("forward").unwrap().unwrap();
        assert_eq!(bg.left, 3);
        assert!(p.reserve("backfill").is_err());
        let mut fg = p.reserve("interactive").unwrap().unwrap();
        assert_eq!(fg.left, 7);
        assert!(p.reserve("interactive").is_err());
        fg.left -= 5;
        drop(fg);
        bg.left = 0;
        drop(bg);
        assert_eq!(p.clone().reserve("interactive").unwrap().unwrap().left, 2);
        fs::remove_file(tmp.path().join("meter.json")).unwrap();
        assert!(p.reserve("interactive").is_err());
    }
}
