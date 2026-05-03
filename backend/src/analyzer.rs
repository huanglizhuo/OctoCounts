use std::{
    fs,
    io::Cursor,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context};
use chrono::Utc;
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use tar::Archive;
use tempfile::TempDir;
use tokei::{Config, Language, Languages, Report as TokeiReport};
use tokio::time::timeout;

use crate::models::{LanguageReport, LanguageStats, RepoRef, Report, Repository};

const TOKEI_VERSION: &str = "tokei-12.1";
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILES: usize = 120_000;
const MAX_SINGLE_FILE_BYTES: u64 = 16 * 1024 * 1024;
const JOB_TIMEOUT: Duration = Duration::from_secs(300);

const IGNORED_DIRS: &[&str] = &[
    ".cache",
    ".git",
    ".next",
    "build",
    "dist",
    "node_modules",
    "target",
    "vendor",
];

#[derive(Clone)]
pub struct AnalysisInput {
    pub repo_ref: RepoRef,
    pub archive: bytes::Bytes,
}

pub fn tokei_version() -> &'static str {
    TOKEI_VERSION
}

pub fn max_archive_bytes() -> u64 {
    MAX_ARCHIVE_BYTES
}

pub async fn analyze(input: AnalysisInput) -> anyhow::Result<Report> {
    timeout(
        JOB_TIMEOUT,
        tokio::task::spawn_blocking(move || analyze_blocking(input)),
    )
    .await
    .context("analysis timed out")?
    .context("analysis task failed")?
}

fn analyze_blocking(input: AnalysisInput) -> anyhow::Result<Report> {
    let started = Instant::now();
    let temp_dir = TempDir::new().context("failed to create temp directory")?;
    let extract_root = temp_dir.path().join("repo");
    fs::create_dir(&extract_root)?;

    extract_archive(&input.archive, &extract_root)?;
    let languages = run_tokei(&extract_root);
    let (language_reports, total) = normalize_languages(&languages);
    let duration_ms = started.elapsed().as_millis();
    let id = report_id(
        &input.repo_ref.owner,
        &input.repo_ref.repo,
        &input.repo_ref.commit_sha,
    );

    Ok(Report {
        id,
        repository: Repository {
            owner: input.repo_ref.owner,
            name: input.repo_ref.repo,
            html_url: input.repo_ref.html_url,
        },
        ref_name: input.repo_ref.ref_name,
        commit_sha: input.repo_ref.commit_sha,
        generated_at: Utc::now(),
        duration_ms,
        cached: false,
        tokei_version: TOKEI_VERSION.to_string(),
        languages: language_reports,
        total,
    })
}

fn extract_archive(archive_bytes: &[u8], destination: &Path) -> anyhow::Result<()> {
    let decoder = GzDecoder::new(Cursor::new(archive_bytes));
    let mut archive = Archive::new(decoder);
    let mut extracted_bytes = 0_u64;
    let mut file_count = 0_usize;

    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        let stripped = strip_archive_root(&path).ok_or_else(|| anyhow!("invalid archive path"))?;

        if stripped.as_os_str().is_empty() || should_ignore(&stripped) {
            continue;
        }

        let out_path = destination.join(&stripped);
        if !out_path.starts_with(destination) {
            return Err(anyhow!("archive contains path traversal"));
        }

        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            fs::create_dir_all(&out_path)?;
            continue;
        }
        if !entry_type.is_file() {
            continue;
        }

        let size = entry.header().size()?;
        if size > MAX_SINGLE_FILE_BYTES {
            continue;
        }
        extracted_bytes = extracted_bytes.saturating_add(size);
        file_count += 1;
        if extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err(anyhow!("repository is too large after extraction"));
        }
        if file_count > MAX_FILES {
            return Err(anyhow!("repository has too many files"));
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        entry.unpack(&out_path)?;
    }

    Ok(())
}

fn strip_archive_root(path: &Path) -> Option<PathBuf> {
    let mut components = path.components();
    components.next()?;
    let mut stripped = PathBuf::new();
    for component in components {
        match component {
            Component::Normal(part) => stripped.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(stripped)
}

fn should_ignore(path: &Path) -> bool {
    path.components().any(|component| {
        let Component::Normal(part) = component else {
            return false;
        };
        let Some(part) = part.to_str() else {
            return false;
        };
        IGNORED_DIRS.iter().any(|ignored| part == *ignored)
    })
}

fn run_tokei(root: &Path) -> Languages {
    let mut languages = Languages::new();
    let config = Config::default();
    languages.get_statistics(&[root], IGNORED_DIRS, &config);
    languages
}

fn normalize_languages(languages: &Languages) -> (Vec<LanguageReport>, LanguageStats) {
    let mut rows: Vec<_> = languages
        .iter()
        .map(|(language_type, language)| language_to_report(language_type.name(), language))
        .collect();
    rows.sort_by(|a, b| {
        b.stats
            .code
            .cmp(&a.stats.code)
            .then_with(|| a.name.cmp(&b.name))
    });

    let total = rows
        .iter()
        .fold(LanguageStats::default(), |mut total, row| {
            add_stats(&mut total, &row.stats);
            total
        });

    (rows, total)
}

fn language_to_report(name: &str, language: &Language) -> LanguageReport {
    let mut children: Vec<_> = language
        .children
        .iter()
        .map(|(language_type, reports)| LanguageReport {
            name: language_type.name().to_string(),
            stats: report_stats(reports),
            children: Vec::new(),
        })
        .collect();
    children.sort_by(|a, b| {
        b.stats
            .code
            .cmp(&a.stats.code)
            .then_with(|| a.name.cmp(&b.name))
    });

    LanguageReport {
        name: name.to_string(),
        stats: LanguageStats {
            files: language.reports.len(),
            lines: language.lines(),
            code: language.code,
            comments: language.comments,
            blanks: language.blanks,
        },
        children,
    }
}

fn report_stats(reports: &[TokeiReport]) -> LanguageStats {
    reports
        .iter()
        .fold(LanguageStats::default(), |mut stats, report| {
            stats.files += 1;
            stats.lines += report.stats.lines();
            stats.code += report.stats.code;
            stats.comments += report.stats.comments;
            stats.blanks += report.stats.blanks;
            stats
        })
}

fn add_stats(total: &mut LanguageStats, stats: &LanguageStats) {
    total.files += stats.files;
    total.lines += stats.lines;
    total.code += stats.code;
    total.comments += stats.comments;
    total.blanks += stats.blanks;
}

fn report_id(owner: &str, repo: &str, sha: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(owner.as_bytes());
    hasher.update(b"/");
    hasher.update(repo.as_bytes());
    hasher.update(b"@");
    hasher.update(sha.as_bytes());
    hasher.update(b":");
    hasher.update(TOKEI_VERSION.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::{report_id, should_ignore};
    use std::path::Path;

    #[test]
    fn cache_key_includes_commit() {
        assert_ne!(report_id("a", "b", "1"), report_id("a", "b", "2"));
    }

    #[test]
    fn ignores_heavy_directories() {
        assert!(should_ignore(Path::new("web/node_modules/react/index.js")));
        assert!(should_ignore(Path::new("target/debug/app")));
        assert!(!should_ignore(Path::new("src/main.rs")));
    }
}
