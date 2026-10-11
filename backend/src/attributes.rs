use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context};

use crate::models::{AnalysisOptions, AnalysisProfile, AttributeStatus, RepositoryAttributes};

const MAX_ATTRIBUTE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 16 * 1024 * 1024;

pub fn filter(root: &Path, options: &AnalysisOptions) -> anyhow::Result<RepositoryAttributes> {
    if !options.respect_gitattributes {
        return Ok(RepositoryAttributes::default());
    }
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut files = Vec::new();
    let mut dirs = vec![root.to_path_buf()];
    let mut attribute_bytes = 0;
    let mut has_attributes = false;
    while let Some(dir) = dirs.pop() {
        if Instant::now() >= deadline {
            return Err(anyhow!("repository attribute filtering timed out"));
        }
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                dirs.push(entry.path());
            } else if entry.file_type()?.is_file() {
                if entry.file_name() == ".gitattributes" {
                    has_attributes = true;
                    attribute_bytes += entry.metadata()?.len();
                    if attribute_bytes > MAX_ATTRIBUTE_BYTES {
                        return Err(anyhow!("repository attribute declarations are too large"));
                    }
                }
                files.push(entry.path().strip_prefix(root)?.to_path_buf());
            }
        }
    }
    if !has_attributes {
        return Ok(RepositoryAttributes {
            status: AttributeStatus::NotFound,
            ..Default::default()
        });
    }
    files.sort();

    // Keep Git metadata outside the archive: adding .git inside it would also
    // change Tokei's existing ignore-file discovery behavior.
    let git_dir = tempfile::TempDir::new()?;
    let mut init = git();
    init.args(["init", "--bare", "--quiet", "--template="])
        .arg(git_dir.path());
    run_git(init, Vec::new(), deadline)?;
    let exclude_generated =
        !options.include_generated || matches!(options.profile, AnalysisProfile::SourceOnly);
    let mut result = RepositoryAttributes {
        status: AttributeStatus::Applied,
        ..Default::default()
    };
    let mut excluded: Vec<PathBuf> = Vec::new();
    for batch in files.chunks(256) {
        let mut input = Vec::new();
        for path in batch {
            input.extend_from_slice(path.as_os_str().as_encoded_bytes());
            input.push(0);
        }
        let mut command = git();
        command
            .arg("--git-dir")
            .arg(git_dir.path())
            .arg("--work-tree")
            .arg(root)
            .args([
                "check-attr",
                "-z",
                "--stdin",
                "linguist-generated",
                "linguist-vendored",
            ]);
        let output = run_git(command, input, deadline)?;
        let fields: Vec<&[u8]> = output.split(|byte| *byte == 0).collect();
        if fields.len() != batch.len() * 6 + 1 || fields.last() != Some(&&b""[..]) {
            return Err(anyhow!("invalid Git attribute response"));
        }
        for (path, attributes) in batch.iter().zip(fields[..fields.len() - 1].chunks_exact(6)) {
            let bytes = path.as_os_str().as_encoded_bytes();
            if attributes[0] != bytes
                || attributes[3] != bytes
                || attributes[1] != b"linguist-generated"
                || attributes[4] != b"linguist-vendored"
            {
                return Err(anyhow!("invalid Git attribute path"));
            }
            let generated = exclude_generated && matches!(attributes[2], b"set" | b"true");
            let vendored = matches!(attributes[5], b"set" | b"true");
            result.generated_files += usize::from(generated);
            result.vendored_files += usize::from(vendored);
            if generated || vendored {
                excluded.push(path.clone());
            }
        }
    }
    // Resolve every override before deleting any attribute file.
    result.excluded_files = excluded.len();
    for path in excluded {
        fs::remove_file(root.join(path)).context("failed to exclude a repository-declared file")?;
    }
    Ok(result)
}

fn git() -> Command {
    let mut command = Command::new("git");
    command
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_ATTR_NOSYSTEM", "1")
        .args(["-c", "core.attributesFile=/dev/null"]);
    command
}

fn run_git(mut command: Command, input: Vec<u8>, deadline: Instant) -> anyhow::Result<Vec<u8>> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Git is required for repository declaration filtering")?;
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    std::thread::scope(|scope| {
        let write = scope.spawn(move || stdin.write_all(&input));
        let out = scope.spawn(move || {
            let mut bytes = Vec::new();
            stdout
                .take(MAX_OUTPUT_BYTES + 1)
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        });
        let err = scope.spawn(move || {
            let mut bytes = Vec::new();
            stderr
                .take(64 * 1024)
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        });
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                other => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(anyhow!(
                        "repository attribute filtering failed or timed out: {other:?}"
                    ));
                }
            }
        };
        let output = out
            .join()
            .map_err(|_| anyhow!("attribute output reader failed"))??;
        let errors = err
            .join()
            .map_err(|_| anyhow!("attribute error reader failed"))??;
        let written = write
            .join()
            .map_err(|_| anyhow!("attribute input writer failed"))?;
        if !status?.success() || !errors.is_empty() {
            return Err(anyhow!("Git could not apply repository declarations"));
        }
        written.context("failed to send paths to Git")?;
        if output.len() as u64 > MAX_OUTPUT_BYTES {
            return Err(anyhow!("repository attribute response is too large"));
        }
        Ok(output)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> tempfile::TempDir {
        let root = tempfile::TempDir::new().unwrap();
        fs::create_dir(root.path().join("nested")).unwrap();
        // Exercise Git's macro, quoting, override and attribute-state semantics.
        fs::write(root.path().join(".gitattributes"), "[attr]both linguist-generated linguist-vendored\n*.rs linguist-generated\nthird.rs both\n\"space name.rs\" linguist-vendored=true\n").unwrap();
        fs::write(root.path().join("nested/.gitattributes"), "keep.rs -linguist-generated\nreset.rs !linguist-generated\nfalse.rs linguist-generated=false\n").unwrap();
        for name in [
            "generated.rs",
            "third.rs",
            "space name.rs",
            "nested/keep.rs",
            "nested/reset.rs",
            "nested/false.rs",
        ] {
            fs::write(root.path().join(name), "fn main() {}\n").unwrap();
        }
        root
    }

    #[test]
    fn declarations_apply_nested_overrides_and_deduplicate_exclusions() {
        let root = fixture();
        let options = AnalysisOptions {
            respect_gitattributes: true,
            ..Default::default()
        };
        let result = filter(root.path(), &options).unwrap();
        assert_eq!(result.status, AttributeStatus::Applied);
        assert_eq!(
            (
                result.generated_files,
                result.vendored_files,
                result.excluded_files
            ),
            (3, 2, 3)
        );
        for name in ["nested/keep.rs", "nested/reset.rs", "nested/false.rs"] {
            assert!(root.path().join(name).exists());
        }
        assert!(!root.path().join("generated.rs").exists());
        assert!(!root.path().join(".git").exists());
    }

    #[test]
    fn include_generated_keeps_generated_files_but_not_vendored_files() {
        let root = fixture();
        let options = AnalysisOptions {
            respect_gitattributes: true,
            include_generated: true,
            ..Default::default()
        };
        let result = filter(root.path(), &options).unwrap();
        assert_eq!(
            (
                result.generated_files,
                result.vendored_files,
                result.excluded_files
            ),
            (0, 2, 2)
        );
        assert!(root.path().join("generated.rs").exists());
    }

    #[test]
    fn off_and_missing_declarations_are_distinct() {
        let root = tempfile::TempDir::new().unwrap();
        assert_eq!(
            filter(root.path(), &AnalysisOptions::default())
                .unwrap()
                .status,
            AttributeStatus::Off
        );
        assert_eq!(
            filter(
                root.path(),
                &AnalysisOptions {
                    respect_gitattributes: true,
                    ..Default::default()
                }
            )
            .unwrap()
            .status,
            AttributeStatus::NotFound
        );
    }

    #[test]
    fn oversized_declarations_fail_before_any_source_is_removed() {
        let root = fixture();
        let attributes = fs::File::create(root.path().join(".gitattributes")).unwrap();
        attributes.set_len(MAX_ATTRIBUTE_BYTES + 1).unwrap();
        let options = AnalysisOptions {
            respect_gitattributes: true,
            ..Default::default()
        };
        assert!(filter(root.path(), &options)
            .unwrap_err()
            .to_string()
            .contains("too large"));
        assert!(root.path().join("generated.rs").exists());
    }
}
