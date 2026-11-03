import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CompareRepos, DiffRefs } from "../compare";
import { BadgeBuilder, BadgeWall, EmbedBuilder } from "../badges";
import { MarketingShell } from "../growth/MarketingShell";
import { StoreLink } from "../StoreLink";

import { COMPARE_REGISTRY } from "../../functions/compare-registry.js";

// Marketing/growth pages (stats, recent, popular, trending, hall of
// monoliths, compare, diff). main.tsx lazy-imports these so the home page
// bundle does not carry them.

export function ComparePage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("compare.title")}>
        <span className="chart-tag">{t("compare.subtitle")}</span>
        <h1>{t("compare.title")}</h1>
        <p>{t("compare.help")}</p>
      </section>
      <CompareRepos showHelp={false} />
      {/* The same curated list the edge renders into /compare's server HTML. */}
      <section aria-label={t("compare.curatedTitle")}>
        <div className="section-h">
          <h2>{t("compare.curatedTitle")}</h2>
          <span className="sub">{t("compare.curatedSubtitle")}</span>
        </div>
        <ul className="link-columns">
          {COMPARE_REGISTRY.map((entry) => (
            <li key={entry.slug}><a href={`/compare/${entry.slug}`}>{entry.name}</a></li>
          ))}
        </ul>
      </section>
    </MarketingShell>
  );
}

// The curated /compare/:slug contract (SG-01): the Pages Function builds one
// view model and renders three representations from it — the SSR HTML body,
// this React page, and the markdown twin. Numbers arrive as pre-formatted
// display strings so a browser locale can never disagree with the SSR body.
type CuratedCompareSide = {
  repoFullName: string;
  publicPath: string;
  snapshotUrl?: string;
  refName: string;
  commitSha: string;
  generatedAt: string;
};

type CuratedCompareModel = {
  state: "ready" | "missing" | "unavailable";
  slug: string;
  name: string;
  canonical: string;
  heading: string;
  interactiveHref: string;
  left?: CuratedCompareSide;
  right?: CuratedCompareSide;
  rows?: Array<{ label: string; left: string; right: string }>;
  definitionText?: string;
  summaryText?: string;
  languageMixText?: string;
  methodologyText?: string;
  policyText?: string;
  retentionText?: string;
  disclaimerText?: string;
  faq?: Array<{ question: string; answer: string }>;
  relatedLinks?: Array<{ href: string; label: string }>;
  editorial?: {
    scope: string;
    insights: string[];
    caution: string;
    sources: Array<{ label: string; url: string }>;
    verifiedAt: string;
  } | null;
};

function readCuratedCompareModel(): CuratedCompareModel | null {
  const node = document.getElementById("octocounts-compare-data");
  if (!node?.textContent) return null;
  try {
    const model = JSON.parse(node.textContent) as CuratedCompareModel;
    return model && typeof model.slug === "string" && typeof model.heading === "string" ? model : null;
  } catch {
    return null;
  }
}

export function CuratedComparePage() {
  const { t } = useTranslation();
  const model = useMemo(readCuratedCompareModel, []);
  // Unknown slugs (404 in production) and JS-only previews have no model;
  // they degrade to the generic tool, exactly what /compare shows.
  if (!model) return <ComparePage />;
  const notice =
    model.state === "unavailable"
      ? t("curatedCompare.unavailable")
      : t("curatedCompare.missing");
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={model.heading}>
        <span className="chart-tag">{t("compare.subtitle")}</span>
        <h1>{model.heading}</h1>
        <p>{model.state === "ready" ? model.definitionText : notice}</p>
      </section>
      {model.state === "ready" ? <CuratedCompareBody model={model} /> : null}
      <section className="curated-compare-tool" aria-label={t("compare.title")}>
        <div className="section-h">
          <h2>{t("compare.title")}</h2>
          <span className="sub">{t("compare.help")}</span>
        </div>
        <CompareRepos showHelp={false} />
      </section>
    </MarketingShell>
  );
}

function CuratedCompareBody({ model }: { model: CuratedCompareModel }) {
  const { t } = useTranslation();
  if (!model.left || !model.right || !model.rows) return null;
  // The methodology sentence embeds the same /docs/methodology link the SSR
  // body carries; split the plain string on the shared anchor phrase.
  const methodology = model.methodologyText ?? "";
  const [methodologyLead, methodologyTail] = methodology.split("See the counting methodology");
  return (
    <section className="curated-compare-body" aria-label={t("curatedCompare.resultsAria")}>
      {model.summaryText ? <p>{model.summaryText}</p> : null}
      <table>
        <thead>
          <tr>
            <th>{t("compare.metric")}</th>
            <th><a href={model.left.publicPath}>{model.left.repoFullName}</a></th>
            <th><a href={model.right.publicPath}>{model.right.repoFullName}</a></th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.left}</td>
              <td>{row.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.languageMixText ? <p>{model.languageMixText}</p> : null}
      {model.policyText ? <p>{model.policyText}</p> : null}
      {model.editorial ? (
        <section aria-label={t("curatedCompare.aboutAria")}>
          <h2>{t("curatedCompare.aboutTitle")}</h2>
          <p>{model.editorial.scope}</p>
          {model.editorial.insights.map((insight) => (
            <p key={insight}>{insight}</p>
          ))}
          <p><em>{model.editorial.caution}</em></p>
          <p>
            {t("curatedCompare.sourcesLabel")}{" "}
            {model.editorial.sources.map((source, index) => (
              <span key={source.url}>
                {index > 0 ? " · " : ""}
                <a href={source.url} rel="noreferrer">{source.label}</a>
              </span>
            ))}
            {" "}
            {t("curatedCompare.verified", { date: model.editorial.verifiedAt })}
          </p>
        </section>
      ) : null}
      {methodology ? (
        <p>
          {methodologyLead}See the <a href="/docs/methodology">counting methodology</a>
          {methodologyTail}
        </p>
      ) : null}
      <p>{t("curatedCompare.nextSteps")}</p>
      <ul>
        <li><a href={model.left.publicPath}>{t("curatedCompare.slocReport", { repo: model.left.repoFullName })}</a></li>
        <li><a href={model.right.publicPath}>{t("curatedCompare.slocReport", { repo: model.right.repoFullName })}</a></li>
        <li>
          <a href={model.interactiveHref}>
            {t("curatedCompare.interactive", { left: model.left.repoFullName, right: model.right.repoFullName })}
          </a>
        </li>
      </ul>
      {[model.left, model.right].filter((side) => side.snapshotUrl).map((side) => <p key={side.repoFullName}><a href={side.snapshotUrl}>{t("curatedCompare.savedReport", { repo: side.repoFullName })}</a></p>)}
      {model.retentionText ? <p>{model.retentionText}</p> : null}
      {model.disclaimerText ? <p>{model.disclaimerText}</p> : null}
      {model.faq?.length ? (
        <div className="how">
          <h2>{t("curatedCompare.faqTitle")}</h2>
          {model.faq.map((item) => (
            <div className="step" key={item.question}>
              <h3>{item.question}</h3>
              {item.answer.split(/\n\n+/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {model.relatedLinks?.length ? (
        <nav aria-label={t("curatedCompare.relatedAria")}>
          <ul>
            {model.relatedLinks.map((link) => (
              <li key={link.href}><a href={link.href}>{link.label}</a></li>
            ))}
          </ul>
        </nav>
      ) : null}
    </section>
  );
}

// /extension landing page (SG-03). Static marketing copy that mirrors the
// facts the Pages Function server-renders (functions/[[path]].js
// EXTENSION_CONTENT); the product-facts checker keeps the store URLs in both
// files identical. Install links reuse the site-wide StoreLink analytics with
// placement=extension_page. The en button labels (extensionSection.install*)
// must stay identical to the SSR fallback's "Install from …" copy so
// hydration does not swap the text.
export function ExtensionPage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("extensionLanding.heroTitle")}>
        <h1>{t("extensionLanding.heroTitle")}</h1>
        <p>{t("extensionLanding.heroIntro")}</p>
      </section>
      <section aria-label="Install OctoCounts">
        <div className="section-h">
          <h2>{t("extensionLanding.installTitle")}</h2>
          <span className="sub">{t("extensionLanding.installSubtitle")}</span>
        </div>
        <div className="hero-paths">
          <StoreLink store="chrome" placement="extension_page" className="btn install-btn hero-install-primary" size={15}>
            {t("extensionSection.installChrome")}
          </StoreLink>
          <StoreLink store="edge" placement="extension_page" className="copybtn install-btn secondary-install" size={14}>
            {t("extensionSection.installEdge")}
          </StoreLink>
          <StoreLink store="firefox" placement="extension_page" className="copybtn install-btn secondary-install" size={14}>
            {t("extensionSection.installFirefox")}
          </StoreLink>
        </div>
      </section>
      <section className="extension-guide" aria-label={t("extensionLanding.stepsTitle")}>
        <div className="section-h">
          <h2>{t("extensionLanding.stepsTitle")}</h2>
        </div>
        <ol>
          <li>{t("extensionLanding.step1")}</li>
          <li>{t("extensionLanding.step2")}</li>
          <li>{t("extensionLanding.step3")}</li>
        </ol>
        <h2>{t("extensionLanding.permissionsTitle")}</h2>
        <p>{t("extensionLanding.permissions")}</p>
        <h2>{t("extensionLanding.scopeTitle")}</h2>
        <p>{t("extensionLanding.scope")}</p>
      </section>
      {/* The edge page publishes these Q&As as FAQPage schema; they must be visible. */}
      <section aria-label={t("extensionLanding.faqTitle")}>
        <div className="section-h">
          <h2>{t("extensionLanding.faqTitle")}</h2>
        </div>
        <div className="how">
          {(t("extensionLanding.faq", { returnObjects: true }) as Array<{ question: string; answer: string }>).map((item) => (
            <div className="step" key={item.question}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}

export function DiffPage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("diff.title")}>
        <span className="chart-tag">{t("diff.subtitle")}</span>
        <h1>{t("diff.title")}</h1>
        <p>{t("diff.help")}</p>
      </section>
      <DiffRefs showHelp={false} />
    </MarketingShell>
  );
}

export function BadgesPage() {
  const { t } = useTranslation();
  const [targetRepo, setTargetRepo] = useState(() => new URLSearchParams(window.location.search).get("repo") ?? "");
  const [targetRef, setTargetRef] = useState(() => new URLSearchParams(window.location.search).get("ref") ?? "");
  const faqItems = t("badgesPage.faq", { returnObjects: true }) as Array<{ question: string; answer: string }>;
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("badgesPage.title")}>
        <span className="chart-tag">{t("badgesPage.kicker")}</span>
        <h1>{t("badgesPage.title")}</h1>
        <p>{t("badgesPage.subtitle")}</p>
      </section>
      <form className="badge-target" onSubmit={(event) => event.preventDefault()}>
        <label><span>{t("badgesPage.repoLabel")}</span><input value={targetRepo} onChange={(event) => setTargetRepo(event.target.value)} placeholder="https://github.com/owner/repo" aria-label={t("badgesPage.repoAria")} /></label>
        <label><span>{t("badgesPage.refLabel")}</span><input value={targetRef} onChange={(event) => setTargetRef(event.target.value)} placeholder={t("badgesPage.refPlaceholder")} aria-label={t("badgesPage.refAria")} /></label>
      </form>
      <div className="tool-workspace">
        <section aria-label={t("badgeBuilder.title")}>
          <BadgeBuilder repoUrl={targetRepo} refName={targetRef} report={null} />
        </section>
        <section aria-label={t("embedBuilder.title")}>
          <div className="section-h">
            <h2>{t("embedBuilder.title")}</h2>
            <span className="sub">{t("embedBuilder.subtitle")}</span>
          </div>
          <EmbedBuilder repoUrl={targetRepo} report={null} />
        </section>
      </div>
      <BadgeWall />
      <section aria-label={t("badgesPage.faqTitle")}>
        <div className="section-h">
          <h2>{t("badgesPage.faqTitle")}</h2>
          <span className="sub">{t("badgesPage.faqSubtitle")}</span>
        </div>
        <div className="how">
          {faqItems.map((item, idx) => (
            <div className="step" key={idx}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
