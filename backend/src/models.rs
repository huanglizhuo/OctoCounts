use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub repo_url: String,
    pub ref_name: Option<String>,
    #[serde(default)]
    pub force_refresh: bool,
    #[serde(default)]
    pub options: AnalysisOptions,
    #[serde(default)]
    pub source: AnalysisSource,
}

// One short-lived value per response, serialized straight away: boxing the
// report would buy nothing but an allocation.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AnalyzeResponse {
    Cached {
        #[serde(rename = "reportId")]
        report_id: String,
        report: Report,
    },
    Job {
        #[serde(rename = "jobId")]
        job_id: Uuid,
        status: JobStatus,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: Uuid,
    pub status: JobStatus,
    pub report_id: Option<String>,
    pub error: Option<ApiErrorBody>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_accepted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: String,
    pub repository: Repository,
    pub ref_name: String,
    pub commit_sha: String,
    pub generated_at: DateTime<Utc>,
    pub duration_ms: u128,
    pub cached: bool,
    pub tokei_version: String,
    #[serde(default)]
    pub analysis_key: String,
    #[serde(default)]
    pub analysis_options: AnalysisOptions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counting_policy: Option<CountingPolicy>,
    pub languages: Vec<LanguageReport>,
    pub total: LanguageStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub owner: String,
    pub name: String,
    pub html_url: String,
    #[serde(default = "default_provider")]
    pub provider: RepositoryProvider,
    /// Star count observed when the ref was resolved. A snapshot tied to the
    /// analysis, like every other figure in the report; absent on reports
    /// stored before the field existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stars: Option<u64>,
}

/// Explicit public route semantics; absent query values retain legacy ref auto-detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReportRefKind {
    Tree,
    Commit,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum RepositoryProvider {
    #[serde(rename = "github", alias = "gitHub", alias = "GitHub")]
    GitHub,
    #[serde(rename = "gitlab", alias = "gitLab", alias = "GitLab")]
    GitLab,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptions {
    #[serde(default)]
    pub ignored_dirs: Vec<String>,
    #[serde(default)]
    pub ignored_languages: Vec<String>,
    #[serde(default)]
    pub profile: AnalysisProfile,
    // Field-level defaults are the derived Default (false): a request that
    // omits any of these toggles asks for the canonical exclusion profile,
    // whatever shape the omission takes — no `options` key at all (via
    // AnalyzeRequest's `#[serde(default)]`) or a partial object (here). Until
    // the 2026-11 unification these filled `true`, which made a partial
    // object count everything while a missing one counted canonically; the
    // read-side legacy fill in `store.rs` keeps spelling out the old
    // all-inclusive set for rows stored before the toggles existed.
    #[serde(default)]
    pub include_docs: bool,
    #[serde(default)]
    pub include_tests: bool,
    #[serde(default)]
    pub include_generated: bool,
    // False must stay absent: canonical SQL and legacy cache keys pin the JSON.
    #[serde(default, skip_serializing_if = "is_false")]
    pub respect_gitattributes: bool,
}

impl AnalysisOptions {
    /// THE public-surface counting profile: the option set every SEO-latest
    /// selection (`latest_eligible!`'s canonical guard in `store.rs`) requires
    /// before a `reports` row may stand as its repository's canonical report.
    ///
    /// Since the 2026-11 profile unification this is also what every surface
    /// ships by default: the web form, badges/embeds, the CLI, the MCP server
    /// and the SLOC-history sampler all count under it unless the caller opts
    /// back in to docs/tests/generated files. It remains the derived `Default`
    /// and deserializing `{}` now yields it too (the historic `default_true`
    /// fill that made partial objects all-inclusive is gone). Reports stored
    /// before the toggles existed were counted all-inclusive and are echoed
    /// with the legacy spelling by `store.rs`'s read projection — never this
    /// set.
    ///
    /// Before the canonical guard existed, whichever row was written last won
    /// the SEO surfaces, so a single include-all visit flipped the public
    /// `facebook/react` report from the indexed ~365K-code row to a 698K one.
    /// Named accessor instead of bare `Default::default()` at each call site so
    /// the intent survives refactors, plus a test pinning it to the derived
    /// default and to its serialized JSON.
    pub fn canonical() -> Self {
        Self {
            ignored_dirs: Vec::new(),
            ignored_languages: Vec::new(),
            profile: AnalysisProfile::Default,
            include_docs: false,
            include_tests: false,
            include_generated: false,
            respect_gitattributes: false,
        }
    }

    /// What rows stored before the include toggles existed actually counted:
    /// docs, tests and generated files all included, because the analyzer of
    /// that era had no filtering. The read-side body projection spells missing
    /// `analysisOptions` fields out with this set so legacy rows are echoed
    /// with the semantics their numbers were produced under — filling them
    /// with [`Self::canonical`] would relabel include-all counts as the
    /// public profile.
    pub fn legacy() -> Self {
        Self {
            include_docs: true,
            include_tests: true,
            include_generated: true,
            ..Self::canonical()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountingPolicy {
    pub version: String,
    pub include_docs: bool,
    pub include_tests: bool,
    pub include_generated: bool,
    pub ignored_dirs: Vec<String>,
    pub ignored_languages: Vec<String>,
    pub repository_attributes: RepositoryAttributes,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAttributes {
    pub status: AttributeStatus,
    pub generated_files: usize,
    pub vendored_files: usize,
    pub excluded_files: usize,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttributeStatus {
    #[default]
    Off,
    NotFound,
    Applied,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AnalysisProfile {
    #[default]
    Default,
    SourceOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageReport {
    pub name: String,
    pub stats: LanguageStats,
    pub children: Vec<LanguageReport>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageStats {
    pub files: usize,
    pub lines: usize,
    pub code: usize,
    pub comments: usize,
    pub blanks: usize,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisSource {
    Web,
    Extension,
    GitHubAction,
    Cli,
    Mcp,
    Api,
    Seed,
    #[serde(rename = "github_trending")]
    GitHubTrending,
    /// A historical commit re-analyzed by the SLOC-history backfill task
    /// (`repo_history.rs`), not a user-triggered request.
    SlocBackfill,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthStats {
    pub totals: GrowthTotals,
    pub windows: GrowthWindows,
    pub sources: Vec<GrowthSourceStat>,
    pub languages: Vec<GrowthLanguageStat>,
    pub top_repositories: Vec<GrowthRepositoryStat>,
    pub recent_repositories: Vec<GrowthRepositoryStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GrowthTotals {
    pub reports_generated: i64,
    pub repositories_analyzed: i64,
    pub lines_counted: i64,
    pub code_lines_counted: i64,
    pub languages_detected: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GrowthWindows {
    pub reports_today: i64,
    pub reports_7d: i64,
    pub reports_30d: i64,
    pub repositories_today: i64,
    pub repositories_7d: i64,
    pub repositories_30d: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthSourceStat {
    pub source: AnalysisSource,
    pub reports: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthLanguageStat {
    pub language: String,
    pub code: i64,
    pub lines: i64,
    pub reports: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthRepositoryStat {
    pub provider: RepositoryProvider,
    pub owner: String,
    pub repo: String,
    pub public_path: String,
    pub html_url: String,
    pub ref_name: String,
    pub generated_at: DateTime<Utc>,
    pub total: LanguageStats,
    pub top_language: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RepoRef {
    pub provider: RepositoryProvider,
    pub owner: String,
    pub repo: String,
    pub ref_name: String,
    pub commit_sha: String,
    pub html_url: String,
    pub stars: Option<u64>,
    /// The slug the request used, when the API answered the repository under a
    /// *different* slug — a rename or transfer (`facebook/react`, whose
    /// repository now answers as `react/react`); `None` for an exact or
    /// casing-only match. The filing identity above is already the API's
    /// current spelling; this field exists so the caller can fold everything
    /// still stored under the predecessor slug into it
    /// (`Store::follow_repo_rename`) before the analysis reads or writes the
    /// cache. Never persisted.
    pub renamed_from: Option<(String, String)>,
}

fn default_provider() -> RepositoryProvider {
    RepositoryProvider::GitHub
}

#[cfg(test)]
mod tests {
    use super::{AnalysisSource, AnalyzeRequest, AnalyzeResponse, JobStatus, RepositoryProvider};
    use uuid::Uuid;

    #[test]
    fn analyze_job_response_uses_camel_case_fields() {
        let job_id = Uuid::parse_str("786c8bae-8397-4233-98fb-2c63003a92bd").unwrap();
        let json = serde_json::to_value(AnalyzeResponse::Job {
            job_id,
            status: JobStatus::Queued,
        })
        .unwrap();

        assert_eq!(json["kind"], "job");
        assert_eq!(json["jobId"], "786c8bae-8397-4233-98fb-2c63003a92bd");
        assert!(json.get("job_id").is_none());
    }

    #[test]
    fn analyze_request_deserializes_optional_force_refresh() {
        let json = r#"{"repoUrl":"https://github.com/tokio-rs/axum","refName":"main","forceRefresh":true}"#;
        let request: AnalyzeRequest = serde_json::from_str(json).unwrap();

        assert_eq!(request.repo_url, "https://github.com/tokio-rs/axum");
        assert_eq!(request.ref_name.as_deref(), Some("main"));
        assert!(request.force_refresh);
    }

    #[test]
    fn analyze_request_defaults_force_refresh_to_false() {
        let json = r#"{"repoUrl":"https://github.com/tokio-rs/axum"}"#;
        let request: AnalyzeRequest = serde_json::from_str(json).unwrap();

        assert!(!request.force_refresh);
    }

    #[test]
    fn repository_provider_serializes_lowercase_and_accepts_legacy_camel_case() {
        assert_eq!(
            serde_json::to_value(RepositoryProvider::GitHub).unwrap(),
            "github"
        );
        assert_eq!(
            serde_json::from_str::<RepositoryProvider>(r#""gitHub""#).unwrap(),
            RepositoryProvider::GitHub
        );
        assert_eq!(
            serde_json::from_str::<RepositoryProvider>(r#""gitLab""#).unwrap(),
            RepositoryProvider::GitLab
        );
    }

    #[test]
    fn github_trending_source_uses_the_public_api_label() {
        assert_eq!(
            serde_json::to_value(AnalysisSource::GitHubTrending).unwrap(),
            "github_trending"
        );
        assert_eq!(
            serde_json::from_str::<AnalysisSource>(r#""github_trending""#).unwrap(),
            AnalysisSource::GitHubTrending
        );
    }

    /// The canonical profile is the derived default: every include-* toggle
    /// false, no ignores, the `default` profile. If someone "fixes" the derive
    /// this is the test that fails, and it should — the SEO-latest guard, the
    /// `options_canonical` trigger and the indexed corpus's numbers all assume
    /// this exact set.
    #[test]
    fn canonical_options_are_the_derived_default() {
        use super::AnalysisOptions;
        assert_eq!(AnalysisOptions::canonical(), AnalysisOptions::default());
        assert!(AnalysisOptions::default() == AnalysisOptions::canonical());
    }

    /// Pins the exact serialized shape the `options_canonical` trigger compares
    /// `body->'analysisOptions'` against. jsonb equality is order-insensitive,
    /// so only the *value set* is load-bearing, but keeping the bytes identical
    /// makes trigger-side diffs against this test unambiguous.
    #[test]
    fn canonical_options_serialize_to_the_pinned_json() {
        use super::AnalysisOptions;
        assert_eq!(
            serde_json::to_string(&AnalysisOptions::canonical()).unwrap(),
            r#"{"ignoredDirs":[],"ignoredLanguages":[],"profile":"default","includeDocs":false,"includeTests":false,"includeGenerated":false}"#
        );
    }

    /// The 2026-11 unification: every omission flavour of a request now means
    /// the canonical exclusion profile — a missing `options` key (via
    /// `AnalyzeRequest`'s field-level default) and a partial/empty options
    /// object (via the field defaults here) deserialize identically. Before,
    /// `{}` filled the include toggles with `true`, a different measurement.
    #[test]
    fn an_explicitly_empty_options_object_is_canonical() {
        use super::AnalysisOptions;
        let empty: AnalysisOptions = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, AnalysisOptions::canonical());
    }

    /// Partial objects keep their explicit values; only omitted fields fill
    /// with the canonical default.
    #[test]
    fn partial_options_keep_explicit_toggles() {
        use super::AnalysisOptions;
        let partial: AnalysisOptions = serde_json::from_str(r#"{"includeDocs": true}"#).unwrap();
        assert!(partial.include_docs);
        assert!(!partial.include_tests && !partial.include_generated);
        assert!(partial != AnalysisOptions::canonical());
    }

    /// The legacy spelling: what pre-toggle rows counted under, and what the
    /// read projection must echo for them — never the canonical set.
    #[test]
    fn legacy_options_are_all_inclusive() {
        use super::AnalysisOptions;
        let legacy = AnalysisOptions::legacy();
        assert!(legacy.include_docs && legacy.include_tests && legacy.include_generated);
        assert_eq!(legacy.profile, super::AnalysisProfile::Default);
        assert!(legacy != AnalysisOptions::canonical());
        assert_eq!(
            serde_json::to_string(&legacy).unwrap(),
            r#"{"ignoredDirs":[],"ignoredLanguages":[],"profile":"default","includeDocs":true,"includeTests":true,"includeGenerated":true}"#
        );
    }
}
