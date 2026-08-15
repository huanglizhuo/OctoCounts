use std::{
    collections::HashSet,
    fs,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context};
use chrono::Utc;
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use tar::Archive;
use tempfile::TempDir;
use tokei::{Config, Language, LanguageType, Languages, Report as TokeiReport};
use tokio::time::timeout;

use crate::models::{
    AnalysisOptions, AnalysisProfile, LanguageReport, LanguageStats, RepoRef, Report, Repository,
};

const TOKEI_VERSION: &str = "tokei-12.1";
const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_FILES: usize = 240_000;
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

pub struct AnalysisInput {
    pub repo_ref: RepoRef,
    /// The archive as a blocking stream rather than a buffer. Read on the
    /// blocking thread the analysis already runs on, so the download and the
    /// extraction overlap and the whole tarball is never resident.
    pub archive: Box<dyn Read + Send>,
    pub options: AnalysisOptions,
    pub analysis_key: String,
}

/// Why an analysis did not produce a report.
///
/// The size limit is called out separately because it is the user's problem,
/// not ours: it has its own API error code and status. Everything else is an
/// internal failure the caller reports generically.
#[derive(Debug, thiserror::Error)]
pub enum AnalysisError {
    #[error("repository archive is too large")]
    ArchiveTooLarge,
    #[error(transparent)]
    Failed(#[from] anyhow::Error),
}

pub fn max_archive_bytes() -> u64 {
    MAX_ARCHIVE_BYTES
}

pub async fn analyze(input: AnalysisInput) -> Result<Report, AnalysisError> {
    timeout(
        JOB_TIMEOUT,
        tokio::task::spawn_blocking(move || analyze_blocking(input)),
    )
    .await
    .context("analysis timed out")?
    .context("analysis task failed")?
}

fn analyze_blocking(input: AnalysisInput) -> Result<Report, AnalysisError> {
    analyze_blocking_with_limit(input, MAX_ARCHIVE_BYTES)
}

/// Split out from [`analyze_blocking`] so the limit can be driven down to
/// fixture size in tests; a test that had to produce two gigabytes to check the
/// cap would never be run.
fn analyze_blocking_with_limit(
    input: AnalysisInput,
    max_archive_bytes: u64,
) -> Result<Report, AnalysisError> {
    let AnalysisInput {
        repo_ref,
        archive,
        options,
        analysis_key,
    } = input;
    let started = Instant::now();
    let temp_dir = TempDir::new().context("failed to create temp directory")?;
    let extract_root = temp_dir.path().join("repo");
    fs::create_dir(&extract_root).context("failed to create the extraction directory")?;

    let ignored_dirs = effective_ignored_dirs(&options);

    // The limit is enforced as the bytes arrive, not after the download
    // finishes, so a 3 GB repository is abandoned in the first seconds instead
    // of being paid for in full and then rejected. Once the cap trips, the
    // failure surfaces as an ordinary I/O error somewhere inside gzip or tar,
    // so the reader also records *why* it failed.
    let oversized = Arc::new(AtomicBool::new(false));
    let limited = LimitedReader::new(archive, max_archive_bytes, Arc::clone(&oversized));

    extract_archive(limited, &extract_root, &ignored_dirs).map_err(|error| {
        if oversized.load(Ordering::Relaxed) {
            AnalysisError::ArchiveTooLarge
        } else {
            AnalysisError::Failed(error)
        }
    })?;

    let languages = run_tokei(&extract_root, &ignored_dirs);
    let (language_reports, total) = normalize_languages(&languages, &options);
    let duration_ms = started.elapsed().as_millis();
    let id = report_id(
        &repo_ref.owner,
        &repo_ref.repo,
        &repo_ref.commit_sha,
        &analysis_key,
    );

    let report = Report {
        id,
        repository: Repository {
            provider: repo_ref.provider,
            owner: repo_ref.owner,
            name: repo_ref.repo,
            html_url: repo_ref.html_url,
            stars: repo_ref.stars,
        },
        ref_name: repo_ref.ref_name,
        commit_sha: repo_ref.commit_sha,
        generated_at: Utc::now(),
        duration_ms,
        cached: false,
        tokei_version: TOKEI_VERSION.to_string(),
        analysis_key,
        analysis_options: options,
        languages: language_reports,
        total,
    };

    temp_dir
        .close()
        .context("failed to remove temporary extraction directory")?;

    Ok(report)
}

/// Caps how many bytes may be pulled from the archive stream.
///
/// Reads one byte past the limit deliberately: an archive of exactly
/// `MAX_ARCHIVE_BYTES` is allowed, so the only way to know the stream is too
/// long is to see a byte beyond it. The flag exists because the error has to
/// travel back through `GzDecoder` and `tar`, which flatten everything into
/// `io::Error`; by the time it reaches the caller it is no longer
/// distinguishable from a truncated download.
struct LimitedReader<R> {
    inner: R,
    limit: u64,
    consumed: u64,
    oversized: Arc<AtomicBool>,
}

impl<R: Read> LimitedReader<R> {
    fn new(inner: R, limit: u64, oversized: Arc<AtomicBool>) -> Self {
        Self {
            inner,
            limit,
            consumed: 0,
            oversized,
        }
    }
}

impl<R: Read> Read for LimitedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let allowance = self.limit.saturating_sub(self.consumed).saturating_add(1);
        let cap = allowance.min(buf.len() as u64) as usize;
        let read = self.inner.read(&mut buf[..cap])?;
        self.consumed += read as u64;

        if self.consumed > self.limit {
            self.oversized.store(true, Ordering::Relaxed);
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "repository archive is too large",
            ));
        }
        Ok(read)
    }
}

fn extract_archive<R: Read>(
    source: R,
    destination: &Path,
    ignored_dirs: &[String],
) -> anyhow::Result<()> {
    let decoder = GzDecoder::new(source);
    let mut archive = Archive::new(decoder);
    let mut extracted_bytes = 0_u64;
    let mut file_count = 0_usize;
    // The caller created `destination`; seeding it stops the very first file
    // from re-walking it.
    let mut created_dirs: HashSet<PathBuf> = HashSet::from([destination.to_path_buf()]);

    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        let stripped = strip_archive_root(&path).ok_or_else(|| anyhow!("invalid archive path"))?;

        if stripped.as_os_str().is_empty() || should_ignore(&stripped, ignored_dirs) {
            continue;
        }

        let out_path = destination.join(&stripped);
        if !out_path.starts_with(destination) {
            return Err(anyhow!("archive contains path traversal"));
        }

        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            ensure_dir(&out_path, &mut created_dirs)?;
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

        // Deliberately after the byte and file accounting above: those guards
        // describe the archive we were handed, not the subset we chose to keep,
        // and a repository that used to be rejected as too large must still be
        // rejected. Skipping only avoids the write and the later read.
        if is_uncountable_asset(&stripped) {
            continue;
        }

        if let Some(parent) = out_path.parent() {
            ensure_dir(parent, &mut created_dirs)?;
        }
        entry.unpack(&out_path)?;
    }

    Ok(())
}

/// `create_dir_all`, minus the syscalls for directories we already made.
///
/// A tar lists files depth-first, so calling `create_dir_all` per file asks the
/// kernel about the same chain of parents once for every sibling — a `mkdir`
/// per component per file, each failing with `EEXIST` after the first. Real
/// repositories have long shared prefixes (`src/vs/workbench/contrib/...`), so
/// this is a large multiple of the number of directories that actually exist.
///
/// Remembering the chain rather than just the leaf matters: `create_dir_all`
/// already created every ancestor, so a later sibling deeper in a different
/// branch can stop as soon as it reaches a known ancestor.
fn ensure_dir(path: &Path, created: &mut HashSet<PathBuf>) -> anyhow::Result<()> {
    if created.contains(path) {
        return Ok(());
    }
    fs::create_dir_all(path)?;

    let mut current = Some(path);
    while let Some(dir) = current {
        if !created.insert(dir.to_path_buf()) {
            break;
        }
        current = dir.parent();
    }
    Ok(())
}

/// True when tokei would never count this path, so writing it to disk only buys
/// a write, a directory entry, and a file tokei has to open and reject later.
///
/// The predicate is not a hand-maintained blacklist of image and archive
/// extensions — it asks tokei the same question tokei's own walk asks, so it
/// cannot drift from the counting rules and cannot accidentally swallow a
/// language. `LanguageType::from_path` checks its filename table first
/// (`Makefile`, `meson.build`, `CMakeLists.txt`, `nuget.config`, …) and only
/// then the extension table; neither touches the filesystem.
///
/// Files with no extension are always kept. tokei resolves those by reading a
/// shebang out of the file, which it cannot do for a file we never wrote, and
/// that set also contains the ignore files (`.gitignore`, `.ignore`,
/// `.tokeignore`) whose presence changes which *other* files get walked.
fn is_uncountable_asset(path: &Path) -> bool {
    if path.extension().is_none() {
        return false;
    }
    LanguageType::from_path(path, &Config::default()).is_none()
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

fn should_ignore(path: &Path, ignored_dirs: &[String]) -> bool {
    path.components().any(|component| {
        let Component::Normal(part) = component else {
            return false;
        };
        let Some(part) = part.to_str() else {
            return false;
        };
        ignored_dirs.iter().any(|ignored| part == ignored)
    })
}

fn run_tokei(root: &Path, ignored_dirs: &[String]) -> Languages {
    let mut languages = Languages::new();
    let config = Config::default();
    let ignored_refs: Vec<&str> = ignored_dirs.iter().map(String::as_str).collect();
    languages.get_statistics(&[root], &ignored_refs, &config);
    languages
}

fn normalize_languages(
    languages: &Languages,
    options: &AnalysisOptions,
) -> (Vec<LanguageReport>, LanguageStats) {
    let ignored_languages: Vec<String> = options
        .ignored_languages
        .iter()
        .map(|language| language.to_lowercase())
        .collect();
    let mut rows: Vec<_> = languages
        .iter()
        .filter(|(language_type, _)| {
            !ignored_languages
                .iter()
                .any(|ignored| ignored == &language_type.name().to_lowercase())
        })
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

pub fn analysis_key(options: &AnalysisOptions) -> String {
    let canonical = serde_json::to_string(options).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(TOKEI_VERSION.as_bytes());
    hasher.update(b":");
    hasher.update(canonical.as_bytes());
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect();
    format!("{}:{}", TOKEI_VERSION, &digest[..16])
}

pub fn effective_ignored_dirs(options: &AnalysisOptions) -> Vec<String> {
    let mut dirs: Vec<String> = IGNORED_DIRS
        .iter()
        .map(|value| (*value).to_string())
        .collect();
    dirs.extend(
        options
            .ignored_dirs
            .iter()
            .map(|value| value.trim().to_string()),
    );
    if matches!(options.profile, AnalysisProfile::SourceOnly) || !options.include_docs {
        dirs.extend(
            ["docs", "doc", "documentation"]
                .iter()
                .map(|value| (*value).to_string()),
        );
    }
    if matches!(options.profile, AnalysisProfile::SourceOnly) || !options.include_tests {
        dirs.extend(
            ["test", "tests", "__tests__", "fixtures"]
                .iter()
                .map(|value| (*value).to_string()),
        );
    }
    if matches!(options.profile, AnalysisProfile::SourceOnly) || !options.include_generated {
        dirs.extend(
            ["generated", "gen", ".generated"]
                .iter()
                .map(|value| (*value).to_string()),
        );
    }
    dirs.retain(|value| !value.is_empty());
    dirs.sort();
    dirs.dedup();
    dirs
}

fn report_id(owner: &str, repo: &str, sha: &str, analysis_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(owner.as_bytes());
    hasher.update(b"/");
    hasher.update(repo.as_bytes());
    hasher.update(b"@");
    hasher.update(sha.as_bytes());
    hasher.update(b":");
    hasher.update(analysis_key.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// Differential harness: pins the exact numbers this service sells.
///
/// Lives next to the analyzer rather than in `golden.rs` because it exercises
/// the extraction and counting path end to end, not an HTTP response shape.
#[cfg(test)]
mod difftest;

#[cfg(test)]
mod tests {
    use super::{
        analysis_key, effective_ignored_dirs, ensure_dir, is_uncountable_asset, report_id,
        should_ignore,
    };
    use crate::models::{AnalysisOptions, AnalysisProfile};
    use std::{collections::HashSet, path::Path};

    #[test]
    fn ensure_dir_creates_the_whole_chain_and_records_every_ancestor() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = temp.path();
        let mut created = HashSet::from([root.to_path_buf()]);

        let deep = root.join("a/b/c/d/e/f/g/h");
        ensure_dir(&deep, &mut created).unwrap();
        assert!(deep.is_dir());

        // `create_dir_all` made the ancestors too, so the next file under
        // `a/b/c/` must be able to stop at a hash lookup instead of walking
        // eight components through the kernel again.
        for ancestor in ["a", "a/b", "a/b/c", "a/b/c/d/e/f/g"] {
            assert!(
                created.contains(&root.join(ancestor)),
                "{ancestor} was created but not recorded"
            );
        }
    }

    /// Siblings must still be created; only repeats of the *same* directory are
    /// elided.
    #[test]
    fn ensure_dir_still_creates_previously_unseen_siblings() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = temp.path();
        let mut created = HashSet::from([root.to_path_buf()]);

        ensure_dir(&root.join("shared/left"), &mut created).unwrap();
        ensure_dir(&root.join("shared/right"), &mut created).unwrap();
        ensure_dir(&root.join("shared/left"), &mut created).unwrap();

        assert!(root.join("shared/left").is_dir());
        assert!(root.join("shared/right").is_dir());
    }

    /// The payload types that dominate repository size. None of them are
    /// languages, so none of them may reach the disk.
    #[test]
    fn binary_and_asset_payloads_are_skipped_during_extraction() {
        for path in [
            "assets/logo.png",
            "assets/photo.JPEG",
            "assets/icon.ico",
            "assets/Inter.woff2",
            "assets/Inter.ttf",
            "assets/bundle.zip",
            "assets/archive.tar.gz",
            "assets/model.onnx",
            "assets/weights.safetensors",
            "assets/native.so",
            "assets/report.pdf",
            "assets/sheet.xlsx",
            "assets/cache.sqlite3",
            "Cargo.lock",
            "yarn.lock",
            "data/records.csv",
        ] {
            assert!(
                is_uncountable_asset(Path::new(path)),
                "{path} is not counted by tokei and should not be extracted"
            );
        }
    }

    /// The expensive half of the guarantee: nothing tokei counts may be dropped.
    /// SVG in particular looks like an image and is a language.
    #[test]
    fn source_files_are_never_skipped_during_extraction() {
        for path in [
            "src/main.rs",
            "src/app.tsx",
            "src/app.ts",
            "public/bundle.min.js",
            "assets/logo.svg",
            "index.html",
            "styles/app.css",
            "src/Widget.vue",
            "README.md",
            "Cargo.toml",
            "package.json",
            "config/ci.yml",
            "CMakeLists.txt",
            "meson.build",
            "meson_options.txt",
            "nuget.config",
            "scripts/run.sh",
        ] {
            assert!(
                !is_uncountable_asset(Path::new(path)),
                "{path} is counted by tokei and must be extracted"
            );
        }
    }

    /// Extension-less files are resolved by reading a shebang, which only works
    /// if the bytes are on disk. The ignore files in this set additionally
    /// change which *other* files tokei walks, so dropping them would move the
    /// counts for the rest of the tree.
    #[test]
    fn extensionless_files_are_always_extracted() {
        for path in [
            "scripts/deploy",
            "Makefile",
            "Dockerfile",
            "LICENSE",
            ".gitignore",
            ".ignore",
            ".tokeignore",
        ] {
            assert!(
                !is_uncountable_asset(Path::new(path)),
                "{path} must be extracted; its language is decided from its contents"
            );
        }
    }

    #[test]
    fn cache_key_includes_commit() {
        let key = analysis_key(&AnalysisOptions::default());
        assert_ne!(
            report_id("a", "b", "1", &key),
            report_id("a", "b", "2", &key)
        );
    }

    #[test]
    fn ignores_heavy_directories() {
        let ignored = effective_ignored_dirs(&AnalysisOptions::default());
        assert!(should_ignore(
            Path::new("web/node_modules/react/index.js"),
            &ignored
        ));
        assert!(should_ignore(Path::new("target/debug/app"), &ignored));
        assert!(!should_ignore(Path::new("src/main.rs"), &ignored));
    }

    #[test]
    fn source_only_profile_adds_common_non_source_dirs() {
        let options = AnalysisOptions {
            profile: AnalysisProfile::SourceOnly,
            ..AnalysisOptions::default()
        };
        let ignored = effective_ignored_dirs(&options);
        assert!(ignored.contains(&"docs".to_string()));
        assert!(ignored.contains(&"tests".to_string()));
        assert!(ignored.contains(&"generated".to_string()));
    }

    #[test]
    fn analysis_key_changes_with_options() {
        let default_key = analysis_key(&AnalysisOptions::default());
        let custom_key = analysis_key(&AnalysisOptions {
            ignored_dirs: vec!["examples".to_string()],
            ..AnalysisOptions::default()
        });
        assert_ne!(default_key, custom_key);
    }
}
