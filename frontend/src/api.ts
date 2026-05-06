import type { AnalyzeResponse } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8080";

export async function analyzeRepository(request: {
  repoUrl: string;
  refName: string;
  forceRefresh: boolean;
}): Promise<AnalyzeResponse> {
  return fetchJson<AnalyzeResponse>("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repoUrl: request.repoUrl,
      refName: request.refName || undefined,
      forceRefresh: request.forceRefresh,
    }),
  });
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiErrorMessage(body, response.statusText));
  return body as T;
}

function apiErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return fallback || "Request failed";
}
