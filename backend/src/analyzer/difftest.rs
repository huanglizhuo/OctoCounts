//! Differential harness for the extraction + counting path.
//!
//! The whole product is the numbers in a [`Report`]: per-language `code`,
//! `comments`, `blanks`, `lines`, `files`, the `children` nesting, and the
//! totals. Every optimisation in this area — skipping files during extraction,
//! reusing directory handles, moving tokei onto a private thread pool, counting
//! straight out of the tar stream — is only allowed if those numbers do not
//! move. Being slower is recoverable; being wrong is not.
//!
//! So: a set of tarballs built deterministically in-process, run through the
//! real [`analyze_blocking`], and compared against committed snapshots of what
//! the implementation produced before any of this work started. Regenerate with
//! `OCTOCOUNTS_UPDATE_GOLDEN=1 cargo test` and *read the diff* — a change here
//! is a change to what users are told about their repository.
//!
//! The fixtures deliberately cover the cases where a naive optimisation breaks:
//!
//! * `children` nesting (Markdown code fences, HTML `<script>`/`<style>`, Vue)
//! * binary assets sitting next to real source
//! * a UTF-16 file with a BOM, which only counts correctly if the reader
//!   transcodes it — a canary for anything that swaps `parse` for a raw
//!   byte-slice parse
//! * extension-less files identified by shebang
//! * files tokei skips for reasons other than extension: hidden directories,
//!   ignored directories
//! * a deeply nested path, so directory-creation changes stay honest

use flate2::{write::GzEncoder, Compression};

use super::{analyze_blocking, AnalysisInput};
use crate::models::{
    AnalysisOptions, AnalysisProfile, RepoRef, Report, RepositoryProvider,
};

/// Builds a gzipped tar shaped like a codeload archive: every path lives under a
/// single generated root directory, which `strip_archive_root` peels off.
fn tarball(files: &[(&str, Vec<u8>)]) -> bytes::Bytes {
    const ROOT: &str = "octocounts-fixture-0000000";
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    {
        let mut builder = tar::Builder::new(&mut encoder);

        // codeload emits an explicit entry for the root directory; keep it so the
        // directory branch of `extract_archive` stays covered.
        let mut root_header = tar::Header::new_gnu();
        root_header.set_entry_type(tar::EntryType::Directory);
        root_header.set_size(0);
        root_header.set_mode(0o755);
        root_header.set_mtime(0);
        builder
            .append_data(&mut root_header, format!("{ROOT}/"), std::io::empty())
            .unwrap();

        for (path, contents) in files {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Regular);
            header.set_size(contents.len() as u64);
            header.set_mode(0o644);
            header.set_mtime(0);
            builder
                .append_data(&mut header, format!("{ROOT}/{path}"), contents.as_slice())
                .unwrap();
        }
        builder.finish().unwrap();
    }
    bytes::Bytes::from(encoder.finish().unwrap())
}

fn text(contents: &str) -> Vec<u8> {
    contents.as_bytes().to_vec()
}

/// UTF-16LE with a byte-order mark. Read as raw bytes this is mostly NUL padding
/// and decodes to nothing sensible; read through a transcoding reader it is
/// ordinary source. The difference shows up immediately in the counts.
fn utf16le(contents: &str) -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xFE];
    for unit in contents.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

/// A byte sequence that is not valid UTF-8 and contains NULs, i.e. what an image
/// or a compiled artifact actually looks like on the wire.
fn binary_blob(seed: u8, len: usize) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(len);
    for index in 0..len {
        bytes.push(seed.wrapping_add((index as u8).wrapping_mul(37)));
    }
    // Guarantee NUL bytes and invalid UTF-8 regardless of the seed arithmetic.
    bytes[0] = 0x00;
    bytes[1] = 0xFF;
    bytes[2] = 0xFE;
    bytes
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// A plain Rust workspace. Exercises nested block comments, doc comments,
/// comment markers inside string literals, and Markdown code fences (which tokei
/// reports as `children` of Markdown).
fn rust_project() -> bytes::Bytes {
    tarball(&[
        (
            "Cargo.toml",
            text("[package]\nname = \"demo\"\nversion = \"0.1.0\"\n\n# deps\n[dependencies]\nserde = \"1\"\n"),
        ),
        (
            "src/main.rs",
            text(concat!(
                "//! Crate docs.\n",
                "//! Second line.\n",
                "\n",
                "use std::io;\n",
                "\n",
                "/* a /* nested */ block comment */\n",
                "fn main() {\n",
                "    // a line comment\n",
                "    let marker = \"// not a comment\";\n",
                "    let block = \"/* also not a comment */\";\n",
                "    println!(\"{marker}{block}\");\n",
                "}\n",
            )),
        ),
        (
            "src/lib.rs",
            text("pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    // empty\n}\n"),
        ),
        ("src/empty.rs", text("")),
        ("src/no_trailing_newline.rs", text("pub const X: u8 = 1;")),
        (
            "README.md",
            text(concat!(
                "# Demo\n",
                "\n",
                "Some prose.\n",
                "\n",
                "```rust\n",
                "fn example() {\n",
                "    // inside a fence\n",
                "    let _ = 1;\n",
                "}\n",
                "```\n",
                "\n",
                "```python\n",
                "def example():\n",
                "    return 1\n",
                "```\n",
            )),
        ),
        ("tests/integration.rs", text("#[test]\nfn works() {\n    assert!(true);\n}\n")),
        ("docs/guide.md", text("# Guide\n\nRead this.\n")),
        (".gitignore", text("target\n*.tmp\n")),
        ("target/debug/build.rs", text("fn main() {}\n")),
    ])
}

/// A front-end app. Exercises HTML with inline `<script>`/`<style>` (children),
/// Vue single-file components (children), TypeScript/TSX, SVG — which tokei does
/// count — and lockfiles, which it does not.
fn web_app() -> bytes::Bytes {
    tarball(&[
        (
            "index.html",
            text(concat!(
                "<!doctype html>\n",
                "<html>\n",
                "  <head>\n",
                "    <!-- a comment -->\n",
                "    <style>\n",
                "      body { margin: 0; }\n",
                "      /* css comment */\n",
                "      .app { color: red; }\n",
                "    </style>\n",
                "  </head>\n",
                "  <body>\n",
                "    <div id=\"app\"></div>\n",
                "    <script>\n",
                "      // js comment\n",
                "      const app = document.getElementById('app');\n",
                "\n",
                "      app.textContent = 'hi';\n",
                "    </script>\n",
                "  </body>\n",
                "</html>\n",
            )),
        ),
        (
            "styles/app.css",
            text(".a {\n  color: blue;\n}\n\n/* trailing */\n"),
        ),
        (
            "scripts/app.js",
            text("// entry\nexport function boot() {\n  return 1;\n}\n"),
        ),
        (
            "src/App.tsx",
            text(concat!(
                "import React from 'react';\n",
                "\n",
                "/** doc */\n",
                "export const App = () => {\n",
                "  // render\n",
                "  return <div>hi</div>;\n",
                "};\n",
            )),
        ),
        (
            "src/util.ts",
            text("export type Id = string;\n\nexport const id = (value: Id): Id => value;\n"),
        ),
        (
            "src/Widget.vue",
            text(concat!(
                "<template>\n",
                "  <div class=\"widget\">{{ label }}</div>\n",
                "</template>\n",
                "\n",
                "<script>\n",
                "export default {\n",
                "  // options api\n",
                "  props: ['label'],\n",
                "};\n",
                "</script>\n",
                "\n",
                "<style scoped>\n",
                ".widget { color: green; }\n",
                "</style>\n",
            )),
        ),
        (
            "assets/logo.svg",
            text("<svg xmlns=\"http://www.w3.org/2000/svg\">\n  <rect width=\"1\" height=\"1\" />\n</svg>\n"),
        ),
        ("package.json", text("{\n  \"name\": \"web\",\n  \"version\": \"1.0.0\"\n}\n")),
        ("package-lock.json", text("{\n  \"lockfileVersion\": 3\n}\n")),
        ("yarn.lock", text("# yarn lockfile v1\n\nreact@18:\n  version \"18.0.0\"\n")),
        ("node_modules/react/index.js", text("module.exports = {};\n")),
    ])
}

/// Real source sitting next to the binary payloads that dominate many
/// repositories: images, fonts, archives, model weights, compiled objects.
fn binary_assets() -> bytes::Bytes {
    tarball(&[
        ("src/main.py", text("import sys\n\n\ndef main():\n    # go\n    print(sys.argv)\n")),
        ("src/parse.go", text("package main\n\n// Parse does nothing.\nfunc Parse() {}\n")),
        ("assets/logo.png", binary_blob(0x89, 4096)),
        ("assets/photo.jpeg", binary_blob(0xD8, 8192)),
        ("assets/icon.ico", binary_blob(0x11, 1024)),
        ("assets/Inter.woff2", binary_blob(0x77, 4096)),
        ("assets/Inter.ttf", binary_blob(0x00, 4096)),
        ("assets/bundle.zip", binary_blob(0x50, 2048)),
        ("assets/archive.tar.gz", binary_blob(0x1F, 2048)),
        ("assets/model.onnx", binary_blob(0x08, 16384)),
        ("assets/weights.safetensors", binary_blob(0x7B, 8192)),
        ("assets/native.so", binary_blob(0x7F, 4096)),
        ("assets/report.pdf", binary_blob(0x25, 4096)),
        ("assets/sheet.xlsx", binary_blob(0x50, 2048)),
        ("assets/cache.sqlite3", binary_blob(0x53, 4096)),
        ("Cargo.lock", text("# auto-generated\n[[package]]\nname = \"demo\"\n")),
        ("data/records.csv", text("id,name\n1,a\n2,b\n")),
        ("public/bundle.min.js", text("!function(){var a=1;return a}();\n")),
    ])
}

/// The awkward corners: filename-only language detection, shebangs, hidden
/// directories, ignored directories, deep nesting, and a UTF-16 source file.
fn edge_cases() -> bytes::Bytes {
    tarball(&[
        ("Makefile", text("all:\n\t# build\n\techo hi\n")),
        ("Dockerfile", text("FROM scratch\n\n# comment\nCMD [\"/app\"]\n")),
        ("CMakeLists.txt", text("cmake_minimum_required(VERSION 3.0)\n\n# comment\n")),
        ("meson.build", text("project('demo', 'c')\n\n# comment\n")),
        ("scripts/deploy", text("#!/bin/bash\n\n# deploy\nset -eu\necho go\n")),
        ("scripts/run.sh", text("#!/bin/sh\necho run\n")),
        ("scripts/tool.py", text("#!/usr/bin/env python3\nprint(1)\n")),
        ("LICENSE", text("MIT License\n\nCopyright (c) 2024\n")),
        (".github/workflows/ci.yml", text("name: ci\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n")),
        (".hidden/secret.rs", text("fn hidden() {}\n")),
        ("visible.yml", text("name: visible\n# comment\n")),
        ("src/utf16.rs", utf16le("fn wide() {\n    // wide comment\n\n    let _ = 1;\n}\n")),
        ("a/b/c/d/e/f/g/h/deep.go", text("package deep\n\nfunc Deep() {}\n")),
        ("a/b/c/d/e/f/g/h/deeper.rs", text("pub fn deeper() {}\n")),
        ("vendor/lib/thing.c", text("int main(void) { return 0; }\n")),
        ("weird.unknownextension", text("this is not any language\n")),
    ])
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/// What an ordinary API request actually analyses with.
///
/// `AnalysisOptions::default()` is *not* this: the `include_*` flags derive
/// their Rust default from `bool` (`false`), while `#[serde(default = ...)]`
/// makes them `true` when the field is absent from the request body. So the
/// struct default silently drops `docs/`, `tests/` and `generated/`, and real
/// traffic does not. Both are pinned below; going through serde keeps this
/// honest instead of restating the flags by hand.
fn api_options() -> AnalysisOptions {
    serde_json::from_str("{}").unwrap()
}

fn analyze_fixture(archive: bytes::Bytes, options: AnalysisOptions) -> Report {
    analyze_blocking(AnalysisInput {
        repo_ref: RepoRef {
            provider: RepositoryProvider::GitHub,
            owner: "octocounts".to_string(),
            repo: "fixture".to_string(),
            ref_name: "main".to_string(),
            commit_sha: "0".repeat(40),
            html_url: "https://github.com/octocounts/fixture".to_string(),
        },
        archive,
        options,
        analysis_key: "difftest".to_string(),
    })
    .expect("fixture analysis failed")
}

/// Only the counting surface is snapshotted. `generated_at`, `duration_ms` and
/// the id are either clocks or derived from inputs the harness controls, so
/// pinning them would only produce flakes.
fn snapshot(report: &Report) -> String {
    let value = serde_json::json!({
        "languages": report.languages,
        "total": report.total,
    });
    format!("{}\n", serde_json::to_string_pretty(&value).unwrap())
}

fn golden_path(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("testdata")
        .join(name)
}

fn assert_counts_unchanged(name: &str, report: &Report) {
    let actual = snapshot(report);
    let path = golden_path(name);
    if std::env::var("OCTOCOUNTS_UPDATE_GOLDEN").is_ok() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing counting fixture {}: {error}", path.display()));
    assert_eq!(
        actual,
        expected,
        "the counts for {name} moved. This is the product. Do not update {} unless the \
         old numbers were wrong.",
        path.display()
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn rust_project_counts_are_stable() {
    let report = analyze_fixture(rust_project(), api_options());
    assert_counts_unchanged("analyzer_rust_project.json", &report);
}

#[test]
fn web_app_counts_are_stable() {
    let report = analyze_fixture(web_app(), api_options());
    assert_counts_unchanged("analyzer_web_app.json", &report);
}

#[test]
fn binary_assets_counts_are_stable() {
    let report = analyze_fixture(binary_assets(), api_options());
    assert_counts_unchanged("analyzer_binary_assets.json", &report);
}

#[test]
fn edge_case_counts_are_stable() {
    let report = analyze_fixture(edge_cases(), api_options());
    assert_counts_unchanged("analyzer_edge_cases.json", &report);
}

/// The `source-only` profile drops `docs/`, `tests/` and `generated/` on top of
/// the standing ignore list, so it must produce strictly fewer files than the
/// same tree analysed normally.
#[test]
fn source_only_profile_counts_are_stable() {
    let report = analyze_fixture(
        rust_project(),
        AnalysisOptions {
            profile: AnalysisProfile::SourceOnly,
            ..api_options()
        },
    );
    assert_counts_unchanged("analyzer_rust_source_only.json", &report);

    let full = analyze_fixture(rust_project(), api_options());
    assert!(
        report.total.files < full.total.files,
        "source-only stopped excluding anything: {} vs {}",
        report.total.files,
        full.total.files
    );
}

/// `AnalysisOptions::default()` is reachable from Rust call sites and behaves
/// differently from an empty request body. Pin it so the discrepancy cannot
/// change unnoticed.
#[test]
fn struct_default_options_counts_are_stable() {
    let report = analyze_fixture(rust_project(), AnalysisOptions::default());
    assert_counts_unchanged("analyzer_rust_struct_default.json", &report);
}

#[test]
fn custom_ignores_and_language_filters_are_stable() {
    let report = analyze_fixture(
        web_app(),
        AnalysisOptions {
            ignored_dirs: vec!["styles".to_string()],
            ignored_languages: vec!["json".to_string()],
            ..api_options()
        },
    );
    assert_counts_unchanged("analyzer_web_app_filtered.json", &report);
}

/// The snapshots are worthless if the fixtures do not actually reach the
/// behaviour they were built for, and a fixture can silently stop doing so (a
/// typo in a path, a language tokei stops nesting). Assert the shape directly.
#[test]
fn fixtures_exercise_the_behaviour_they_were_built_for() {
    let web = analyze_fixture(web_app(), api_options());
    let html = web
        .languages
        .iter()
        .find(|language| language.name == "HTML")
        .expect("fixture should produce HTML");
    assert!(
        html.children.iter().any(|child| child.name == "JavaScript")
            && html.children.iter().any(|child| child.name == "CSS"),
        "HTML fixture stopped exercising `children` nesting: {:?}",
        html.children
    );
    assert!(
        web.languages.iter().any(|language| language.name == "SVG"),
        "SVG is a counted language and must not be treated as a binary asset"
    );

    let rust = analyze_fixture(rust_project(), api_options());
    let markdown = rust
        .languages
        .iter()
        .find(|language| language.name == "Markdown")
        .expect("fixture should produce Markdown");
    assert!(
        !markdown.children.is_empty(),
        "Markdown code fences stopped producing children"
    );

    let edges = analyze_fixture(edge_cases(), api_options());
    let names: Vec<&str> = edges
        .languages
        .iter()
        .map(|language| language.name.as_str())
        .collect();
    assert!(
        names.contains(&"BASH"),
        "shebang detection for extension-less files stopped working: {names:?}"
    );
    assert!(
        names.contains(&"Makefile") && names.contains(&"Dockerfile"),
        "filename-only language detection stopped working: {names:?}"
    );

    // A UTF-16LE file only lands on these numbers if the reader transcodes it.
    // Read as raw bytes it is NUL-padded noise and the counts collapse.
    let rust_edge = edges
        .languages
        .iter()
        .find(|language| language.name == "Rust")
        .expect("fixture should produce Rust");
    assert_eq!(
        rust_edge.stats.files, 2,
        "the UTF-16 source file stopped being counted"
    );
    assert_eq!(
        rust_edge.stats.lines, 6,
        "the UTF-16 source file stopped being transcoded before counting"
    );

    // Hidden paths are invisible to tokei's walk; a change that starts counting
    // `.github/` would inflate every repository on the site.
    assert_eq!(
        edges
            .languages
            .iter()
            .find(|language| language.name == "YAML")
            .map(|language| language.stats.files),
        Some(1),
        "hidden directories must stay excluded: {names:?}"
    );

    let assets = analyze_fixture(binary_assets(), api_options());
    assert!(
        assets.total.code > 0,
        "the binary fixture must still contain real source to count"
    );
    assert_eq!(
        assets.total.files, 3,
        "binary payloads must not be counted as source"
    );
}

/// Extraction must not lose a file just because it is buried.
#[test]
fn deeply_nested_paths_survive_extraction() {
    let report = analyze_fixture(edge_cases(), api_options());
    let go = report
        .languages
        .iter()
        .find(|language| language.name == "Go")
        .expect("the deeply nested Go file should be counted");
    assert_eq!(go.stats.files, 1);
}

#[test]
fn totals_are_the_sum_of_the_top_level_languages() {
    for archive in [rust_project(), web_app(), binary_assets(), edge_cases()] {
        let report = analyze_fixture(archive, api_options());
        let summed = report
            .languages
            .iter()
            .fold((0, 0, 0, 0, 0), |acc, language| {
                (
                    acc.0 + language.stats.files,
                    acc.1 + language.stats.lines,
                    acc.2 + language.stats.code,
                    acc.3 + language.stats.comments,
                    acc.4 + language.stats.blanks,
                )
            });
        assert_eq!(
            summed,
            (
                report.total.files,
                report.total.lines,
                report.total.code,
                report.total.comments,
                report.total.blanks
            )
        );
    }
}

/// Two runs over the same bytes must agree; parallel walking and parallel
/// parsing must not make the output order- or timing-dependent.
#[test]
fn analysis_is_deterministic() {
    let first = analyze_fixture(web_app(), api_options());
    let second = analyze_fixture(web_app(), api_options());
    assert_eq!(snapshot(&first), snapshot(&second));
}

// ---------------------------------------------------------------------------
// Real-repository mode
// ---------------------------------------------------------------------------

/// Runs the analyzer over real repository tarballs and prints the counts and the
/// wall clock. Ignored by default because it needs archives this repository does
/// not ship.
///
/// ```text
/// curl -sSLo /tmp/three.tar.gz \
///   https://codeload.github.com/mrdoob/three.js/tar.gz/refs/heads/dev
/// OCTOCOUNTS_BENCH_TARBALLS=/tmp/three.tar.gz \
///   cargo test --release analyzer::difftest::real_repositories -- --ignored --nocapture
/// ```
///
/// The point is not the timing. It is that the printed per-language block can be
/// diffed across two builds of this crate: synthetic fixtures cannot cover the
/// long tail of a 400 MB tree, and every change in this batch has to be checked
/// against one before it lands.
#[test]
#[ignore = "needs repository tarballs supplied via OCTOCOUNTS_BENCH_TARBALLS"]
fn real_repositories_are_counted_identically() {
    let Ok(paths) = std::env::var("OCTOCOUNTS_BENCH_TARBALLS") else {
        panic!("set OCTOCOUNTS_BENCH_TARBALLS to a colon-separated list of .tar.gz paths");
    };

    for path in paths.split(':').filter(|path| !path.is_empty()) {
        let archive = bytes::Bytes::from(std::fs::read(path).expect("failed to read tarball"));
        let bytes = archive.len();
        let started = std::time::Instant::now();
        let report = analyze_fixture(archive, api_options());
        let elapsed = started.elapsed();

        println!("=== {path} ({bytes} archive bytes) ===");
        println!("wall clock: {} ms", elapsed.as_millis());
        println!("{}", snapshot(&report));
    }
}

/// Two analyses running at once must produce exactly what each produces alone.
/// The counting pool is process-wide and shared between them, so this is where a
/// pool that deadlocks, oversubscribes, or leaks state between jobs shows up.
#[test]
fn concurrent_analyses_do_not_interfere() {
    let expected_web = snapshot(&analyze_fixture(web_app(), api_options()));
    let expected_rust = snapshot(&analyze_fixture(rust_project(), api_options()));

    let handles: Vec<_> = (0..4)
        .map(|index| {
            std::thread::spawn(move || {
                if index % 2 == 0 {
                    (true, snapshot(&analyze_fixture(web_app(), api_options())))
                } else {
                    (
                        false,
                        snapshot(&analyze_fixture(rust_project(), api_options())),
                    )
                }
            })
        })
        .collect();

    for handle in handles {
        let (is_web, actual) = handle.join().expect("an analysis thread panicked");
        let expected = if is_web { &expected_web } else { &expected_rust };
        assert_eq!(&actual, expected);
    }
}

/// Wall clock for `n` analyses running at once. Same setup as
/// `real_repositories_are_counted_identically`, plus `OCTOCOUNTS_BENCH_JOBS`
/// (default 2) to say how many run concurrently.
///
/// This is the measurement that decided against giving tokei a private rayon
/// pool sized `cores / ANALYSIS_CONCURRENCY`; see
/// `concurrent_analyses_do_not_interfere` for what is actually guaranteed.
///
/// ```text
/// OCTOCOUNTS_BENCH_TARBALLS=/tmp/three.tar.gz OCTOCOUNTS_BENCH_JOBS=2 \
///   cargo test --release analyzer::difftest::concurrent_real -- --ignored --nocapture
/// ```
#[test]
#[ignore = "needs repository tarballs supplied via OCTOCOUNTS_BENCH_TARBALLS"]
fn concurrent_real_repositories_wall_clock() {
    let Ok(paths) = std::env::var("OCTOCOUNTS_BENCH_TARBALLS") else {
        panic!("set OCTOCOUNTS_BENCH_TARBALLS to a colon-separated list of .tar.gz paths");
    };
    let jobs: usize = std::env::var("OCTOCOUNTS_BENCH_JOBS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(2);

    for path in paths.split(':').filter(|path| !path.is_empty()) {
        let archive = bytes::Bytes::from(std::fs::read(path).expect("failed to read tarball"));
        let started = std::time::Instant::now();
        let handles: Vec<_> = (0..jobs)
            .map(|_| {
                let archive = archive.clone();
                std::thread::spawn(move || {
                    let job_started = std::time::Instant::now();
                    let report = analyze_fixture(archive, api_options());
                    (job_started.elapsed(), snapshot(&report))
                })
            })
            .collect();

        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().expect("an analysis thread panicked"))
            .collect();
        let wall = started.elapsed();

        for (_, actual) in &results {
            assert_eq!(actual, &results[0].1, "concurrent analyses disagreed");
        }
        let per_job: Vec<u128> = results
            .iter()
            .map(|(elapsed, _)| elapsed.as_millis())
            .collect();
        println!(
            "=== {path} | {jobs} concurrent | wall {} ms | per job {per_job:?} ms",
            wall.as_millis()
        );
    }
}
