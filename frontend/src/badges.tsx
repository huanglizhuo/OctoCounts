import { Clipboard } from "lucide-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnalyticsEvents, trackEvent } from "./analytics";
import { defaultRepoUrl } from "./constants";
import { copyText, normalizedProvider } from "./reportUtils";
import type { Report } from "./types";

// README badge tooling: the builder (badge type / language picker plus a
// markdown copy row) and the live badge wall. Extracted from main.tsx so the
// home page section and the standalone /badges page render the same thing.

export const badgeTypes = ["summary", "code", "lines", "files", "comments", "languages", "top-language", "ratio", "language"] as const;

const BADGE_API_BASE = (import.meta.env.VITE_BADGE_API_BASE ?? "https://api.octocounts.com") as string;

export function BadgeBuilder({ repoUrl, refName, report }: { repoUrl: string; refName: string; report: Report | null }) {
  const { t } = useTranslation();
  const [badgeType, setBadgeType] = useState<(typeof badgeTypes)[number]>("summary");
  const [language, setLanguage] = useState("rust");
  const repoPath = report && normalizedProvider(report) === "github"
    ? { owner: report.repository.owner, repo: report.repository.name }
    : parseGitHubRepo(repoUrl || defaultRepoUrl);
  const effectiveRef = report?.refName || refName.trim();
  const badgeUrl = repoPath ? buildBadgeUrl(repoPath.owner, repoPath.repo, effectiveRef, badgeType, language) : "";
  const frontendUrl = repoPath ? buildPublicReportUrl(repoPath.owner, repoPath.repo, effectiveRef, "github") : window.location.origin;
  const markdown = badgeUrl ? `[![OctoCounts](${badgeUrl})](${frontendUrl})` : "";

  return (
    <div className="badge-builder">
      <div className="badge-builder-controls">
        <label>
          <span>{t("badgeBuilder.type")}</span>
          <select value={badgeType} onChange={(event) => setBadgeType(event.target.value as (typeof badgeTypes)[number])}>
            {badgeTypes.map((type) => (
              <option value={type} key={type}>{t(`badgeBuilder.types.${type}`)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("badgeBuilder.language")}</span>
          <input value={language} onChange={(event) => setLanguage(event.target.value)} disabled={badgeType !== "language"} placeholder="rust" />
        </label>
      </div>
      <div className="badge-builder-preview">
        {badgeUrl ? <img src={badgeUrl} alt={t("badgeBuilder.previewAlt")} width="180" height="20" /> : <span>{t("badgeBuilder.noRepo")}</span>}
      </div>
      <div className="badge-builder-output">
        <code>{markdown || t("badgeBuilder.noRepo")}</code>
        <button className="copybtn" type="button" disabled={!markdown} onClick={() => { copyText(markdown); trackEvent(AnalyticsEvents.badgeMarkdownCopied, { provider: "github", placement: "builder" }); }}>
          <Clipboard size={14} />
          {t("badgeBuilder.copyMarkdown")}
        </button>
      </div>
    </div>
  );
}

// iframe embed tooling: a copyable <iframe> snippet pointing at the
// /embed/:provider/:owner/:repo card, plus a live preview of that card.
export function EmbedBuilder({ repoUrl, report }: { repoUrl: string; report: Report | null }) {
  const { t } = useTranslation();
  const repoPath = report && normalizedProvider(report) === "github"
    ? { owner: report.repository.owner, repo: report.repository.name }
    : parseGitHubRepo(repoUrl || defaultRepoUrl);
  const embedUrl = repoPath ? buildEmbedUrl("github", repoPath.owner, repoPath.repo) : "";
  const snippet = embedUrl ? buildEmbedSnippet(embedUrl) : "";

  return (
    <div className="badge-builder embed-builder">
      <p className="badge-embed-desc">{t("embedBuilder.description")}</p>
      <div className="badge-builder-preview embed-builder-preview">
        {embedUrl ? <iframe src={embedUrl} width="400" height="160" frameBorder="0" loading="lazy" title={t("embedBuilder.previewAlt")} /> : <span>{t("badgeBuilder.noRepo")}</span>}
      </div>
      <div className="badge-builder-output">
        <code>{snippet || t("badgeBuilder.noRepo")}</code>
        <button className="copybtn" type="button" disabled={!snippet} onClick={() => { copyText(snippet); trackEvent(AnalyticsEvents.embedSnippetCopied, { provider: "github", placement: "badges_page" }); }}>
          <Clipboard size={14} />
          {t("embedBuilder.copy")}
        </button>
      </div>
    </div>
  );
}

const badgeWallEntries: Array<{ owner: string; repo: string; type: (typeof badgeTypes)[number] }> = [
  { owner: "huanglizhuo", repo: "OctoCounts", type: "summary" },
  { owner: "tokio-rs", repo: "axum", type: "code" },
  { owner: "vitejs", repo: "vite", type: "top-language" },
];

export function BadgeWall() {
  const { t } = useTranslation();
  return (
    <div className="badge-wall">
      <div className="badge-wall-head">
        <span className="chart-tag">{t("badgeWall.kicker")}</span>
        <span>{t("badgeWall.hint")}</span>
      </div>
      <div className="badge-wall-row">
        {badgeWallEntries.map((entry) => (
          <a key={`${entry.owner}/${entry.repo}`} href={buildPublicReportUrl(entry.owner, entry.repo, "")} target="_blank" rel="noreferrer">
            <img src={buildBadgeUrl(entry.owner, entry.repo, "", entry.type, "")} alt={t("badgeWall.alt", { repo: `${entry.owner}/${entry.repo}` })} loading="lazy" width="180" height="20" />
            <code>{entry.owner}/{entry.repo}</code>
          </a>
        ))}
      </div>
    </div>
  );
}

function parseGitHubRepo(value: string) {
  const parsed = parsePublicRepo(value);
  if (!parsed || parsed.host !== "github.com") return null;
  return { owner: parsed.owner, repo: parsed.repo };
}

export function parsePublicRepo(value: string) {
  try {
    const trimmed = value.trim();
    const normalized = trimmed.startsWith("git@github.com:")
      ? trimmed.replace("git@github.com:", "https://github.com/")
      : trimmed;
    const url = new URL(normalized);
    if (url.hostname !== "github.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return {
      host: url.hostname,
      owner: segments.slice(0, -1).join("/"),
      repo: segments[segments.length - 1].replace(/\.git$/, ""),
    };
  } catch {
    return null;
  }
}

export function buildPublicReportUrl(owner: string, repo: string, ref: string, provider: "github" | "gitlab" = "github") {
  const ownerPath = provider === "gitlab"
    ? owner.split("/").map(encodeURIComponent).join("/")
    : encodeURIComponent(owner);
  const base = `${window.location.origin}/${provider}/${ownerPath}/${encodeURIComponent(repo)}`;
  if (!ref.trim()) return base;
  const marker = looksLikeCommit(ref) ? "commit" : "tree";
  return `${base}/${marker}/${encodeRefPath(ref)}`;
}

function encodeRefPath(ref: string) {
  return ref.trim().split("/").map(encodeURIComponent).join("/");
}

function looksLikeCommit(ref: string) {
  return /^[a-f0-9]{7,40}$/i.test(ref.trim());
}

export type EmbedProvider = "github" | "gitlab";

export function buildEmbedUrl(provider: EmbedProvider, owner: string, repo: string) {
  const ownerPath = owner.split("/").map(encodeURIComponent).join("/");
  return `${window.location.origin}/embed/${provider}/${ownerPath}/${encodeURIComponent(repo)}`;
}

export function buildEmbedSnippet(embedUrl: string, width = 400, height = 160) {
  return `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" loading="lazy"></iframe>`;
}

export function buildBadgeUrl(owner: string, repo: string, ref: string, type: (typeof badgeTypes)[number], language: string) {
  const safeOwner = encodeURIComponent(owner);
  const safeRepo = encodeURIComponent(repo);
  const refKind = looksLikeCommit(ref) ? "commit" : "branch";
  const safeRef = ref.trim() ? `/${refKind}/${encodeRefPath(ref)}` : "";
  const params = new URLSearchParams();
  if (type === "language") {
    params.set("lang", language.trim() || "rust");
  } else if (type !== "summary") {
    params.set("type", type);
  }
  const query = params.toString();
  return `${BADGE_API_BASE}/badge/${safeOwner}/${safeRepo}${safeRef}${query ? `?${query}` : ""}`;
}
