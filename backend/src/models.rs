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
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepositoryProvider {
    GitHub,
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
    #[serde(default = "default_true")]
    pub include_docs: bool,
    #[serde(default = "default_true")]
    pub include_tests: bool,
    #[serde(default = "default_true")]
    pub include_generated: bool,
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

#[derive(Debug, Clone)]
pub struct RepoRef {
    pub provider: RepositoryProvider,
    pub owner: String,
    pub repo: String,
    pub ref_name: String,
    pub commit_sha: String,
    pub html_url: String,
}

fn default_true() -> bool {
    true
}

fn default_provider() -> RepositoryProvider {
    RepositoryProvider::GitHub
}

#[cfg(test)]
mod tests {
    use super::{AnalyzeRequest, AnalyzeResponse, JobStatus};
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
}
