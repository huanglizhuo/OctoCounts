use std::time::Duration;

// Run explicitly after CA/runtime updates; never send application credentials.
#[tokio::test]
#[ignore = "requires public certificate test endpoints"]
async fn rejects_compromised_intermediates() {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();
    client.get("https://example.com").send().await.unwrap();
    for host in [
        "dv-g3b-emudhra.we-have-a-problem.com",
        "dv-g3b-aaa-emudhra.we-have-a-problem.com",
        "dv-g3b-noct-emudhra.we-have-a-problem.com",
        "dv-g3b-aaa-noct-emudhra.we-have-a-problem.com",
    ] {
        let error = client
            .get(format!("https://{host}/"))
            .send()
            .await
            .unwrap_err();
        let detail = format!("{error:?}").to_lowercase();
        assert!(
            !error.is_timeout() && detail.contains("cert"),
            "{host}: {detail}"
        );
    }
}
