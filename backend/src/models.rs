use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub repo_url: String,
    pub ref_name: Option<String>,
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
    pub languages: Vec<LanguageReport>,
    pub total: LanguageStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub owner: String,
    pub name: String,
    pub html_url: String,
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
    pub owner: String,
    pub repo: String,
    pub ref_name: String,
    pub commit_sha: String,
    pub html_url: String,
}

#[cfg(test)]
mod tests {
    use super::{AnalyzeResponse, JobStatus};
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
}
