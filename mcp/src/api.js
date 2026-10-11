export function repositoryOptions(enabled) {
  if (enabled !== undefined && typeof enabled !== "boolean") throw new Error("respect_gitattributes must be a boolean");
  return enabled ? { ignoredDirs: [], ignoredLanguages: [], profile: "default", includeDocs: false, includeTests: false, includeGenerated: false, respectGitattributes: true } : undefined;
}

export async function analyzeAndWait(apiBase, request, { signal, timeoutMs = 300_000 } = {}) {
  const controller = new AbortController();
  signal?.throwIfAborted();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const deadline = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(new DOMException("OctoCounts analysis timed out", "TimeoutError")), timeoutMs);
  const context = { signal: controller.signal, deadline };
  let jobId;
  try {
    const result = await fetchJson(`${apiBase}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }, context);
    if (result?.kind === "cached" && result.report) return result.report;
    if (result?.kind !== "job" || !result.jobId) throw new Error("Unexpected OctoCounts analyze response");
    jobId = result.jobId;
    while (Date.now() < deadline) {
      const job = await fetchJson(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}?wait=20`, {}, context);
      if (job.status === "completed" && job.reportId) return await fetchJson(`${apiBase}/api/reports/${encodeURIComponent(job.reportId)}`, {}, context);
      if (job.status === "failed") throw Object.assign(new Error(`${job.error?.code ? `[${job.error.code}] ` : ""}${job.error?.message ?? "OctoCounts analysis failed"}`), { code: job.error?.code });
      await sleep(250, controller.signal);
    }
    throw new Error("OctoCounts analysis timed out");
  } catch (error) {
    if (jobId) throw Object.assign(new Error(`${error.message}; job ${jobId}; resume with GET ${apiBase}/api/jobs/${encodeURIComponent(jobId)}`, { cause: error }), { status: error.status, code: error.code, retryAfterMs: error.retryAfterMs, jobId });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function fetchJson(url, init = {}, { signal = init.signal, deadline = Date.now() + 300_000 } = {}) {
  const isGet = !init.method || init.method === "GET";
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new DOMException("OctoCounts request timed out", "TimeoutError");
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("OctoCounts request timed out", "TimeoutError")), Math.min(30_000, deadline - Date.now()));
    let failure;
    try {
      return await readJsonResponse(await fetch(url, { ...init, signal: controller.signal }));
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
    signal?.throwIfAborted();
    const canRetry = failure.status !== undefined
      ? [429, 500, 502, 503, 504].includes(failure.status) && (isGet || failure.requestAccepted === false)
      : isGet && (failure instanceof TypeError || failure.name === "TimeoutError");
    const waitMs = failure.retryAfterMs ?? 500 * 2 ** attempt + Math.random() * 250;
    if (!canRetry || attempt >= 3 || !Number.isFinite(waitMs) || Date.now() + waitMs >= deadline) throw failure;
    await sleep(waitMs, signal);
  }
}

export async function readJsonResponse(response) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok || body === null) {
    const error = new Error(`HTTP ${response.status}${body?.code ? ` [${body.code}]` : ""}: ${body?.message ?? (response.statusText || "invalid JSON response")}`);
    error.status = response.status;
    error.code = body?.code;
    error.requestAccepted = body?.requestAccepted;
    error.retryAfterMs = retryAfterMs(response.headers.get("retry-after"));
    error.body = body;
    if (error.retryAfterMs !== undefined) error.message += `; retry after ${Math.ceil(error.retryAfterMs / 1000)} seconds`;
    throw error;
  }
  return body;
}

export function retryAfterMs(value) {
  if (value === null) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function sleep(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function reportUrl(report) {
  const base = `https://octocounts.com/github/${encodeURIComponent(report.repository.owner)}/${encodeURIComponent(report.repository.name)}`;
  const ref = String(report.commitSha || report.refName || "").trim();
  const params = new URLSearchParams();
  if (report.id) params.set("reportId", report.id);
  if (report.analysisOptions) params.set("analysis", JSON.stringify(report.analysisOptions));
  const query = params.toString();
  return `${base}${ref ? `/${/^[a-f0-9]{7,40}$/i.test(ref) ? "commit" : "tree"}/${ref.split("/").map(encodeURIComponent).join("/")}` : ""}${query ? `?${query}` : ""}`;
}

export function policyCompatibility(left, right) {
  if (!left.countingPolicy || !right.countingPolicy) return "unknown";
  const signature = (report) => {
    const { repositoryAttributes, ignoredDirs, ignoredLanguages, ...policy } = report.countingPolicy;
    return JSON.stringify({ version: policy.version, includeDocs: policy.includeDocs, includeTests: policy.includeTests, includeGenerated: policy.includeGenerated, engine: report.tokeiVersion, ignoredDirs: [...new Set(ignoredDirs)].sort(), ignoredLanguages: [...new Set(ignoredLanguages.map((language) => language.toLowerCase()))].sort(), attributes: repositoryAttributes.status !== "off" });
  };
  return signature(left) === signature(right) ? "same" : "different";
}
