// Language leaderboards: the model behind /languages and /languages/:slug.
// One model feeds the edge HTML body, the Markdown twin, the JSON-LD and the
// client React page (#octocounts-language-data), so the representations
// cannot drift. Facts only: every figure comes from /api/seo/languages and
// /api/seo/language/:slug, which count public reports measured under the
// canonical options.
import { MIN_INDEXABLE_REPORT_FILES, readableDate } from "./report-copy.js";
import { comparisonsForLanguage } from "./compare-registry.js";

export const LANGUAGES_PATH = "/languages";
/// The hub's `<title>`, also used when the hub itself cannot be rendered.
export const LANGUAGE_HUB_TITLE = "Largest codebases by programming language | OctoCounts";

const BRAND = " | OctoCounts";
const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;

export const DATA_FORMAT_EXAMPLES = "JSON, YAML, TOML and Markdown";

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/// The first title that fits a search snippet, with the brand when there is
/// room for it and without when the language name needs the width.
function pageTitle(...candidates) {
  for (const text of candidates) {
    if (text.length + BRAND.length <= TITLE_LIMIT) return `${text}${BRAND}`;
  }
  for (const text of candidates) {
    if (text.length <= TITLE_LIMIT) return text;
  }
  return candidates.at(-1);
}

const RELATED_HUB = [
  { href: "/", label: "OctoCounts: count lines of code in any public GitHub repository" },
  { href: "/hall-of-monoliths", label: "Hall of Monoliths: largest repositories by lines of code" },
  { href: "/popular", label: "Popular SLOC reports" },
  { href: "/docs/methodology", label: "How OctoCounts counts lines of code" },
  { href: "/docs/largest-codebases", label: "How many lines of code? The largest codebases, counted" },
  { href: "/research", label: "Research: how filtering changes SLOC counts" },
];

const COMPLEXITY_ANSWER = "Not necessarily. SLOC measures size, not complexity, quality, or maintainability. A larger codebase can mean more features, more generated or vendored code, more verbose language idioms, or more tests — none of which imply the code is harder to work with. Use line counts to gauge the scale of what you would be reading or maintaining, not as a quality signal.";

/// The model of /languages: one row per language that has a leaderboard.
export function languageHubModel(index) {
  const languages = index.languages;
  const measured = languages.reduce((sum, entry) => sum + entry.repositories, 0);
  const columns = ["Language", "Repositories", "Code lines counted"];
  return {
    kind: "hub",
    title: LANGUAGE_HUB_TITLE,
    heading: "The largest codebases by programming language",
    description: "OctoCounts leaderboards of public GitHub repositories grouped by primary programming language and ranked by source lines of code.",
    intro: `OctoCounts groups the public GitHub repositories it has measured by their primary programming language — the programming language with the most code lines in the repository — and ranks each group by source lines of code. ${formatNumber(languages.length)} languages have at least ${formatNumber(index.minRepositories)} measured repositories, ${formatNumber(measured)} repositories in all. Open a language to see its largest repositories; every count is pinned to the commit it counted, counted with tokei, and states its counting rules.`,
    columns,
    rows: languages.map((entry) => [
      { text: entry.language, href: `${LANGUAGES_PATH}/${entry.slug}` },
      { text: formatNumber(entry.repositories) },
      { text: formatNumber(entry.code) },
    ]),
    afterTable: "A repository counts once, under one language: its primary programming language. Data and prose formats such as JSON, YAML, TOML and Markdown never make a repository theirs, so a lockfile-heavy TypeScript library is a TypeScript repository. \"Code lines counted\" adds up the code lines in each group's reports; it measures how much source OctoCounts has counted in those repositories, not how much of it is written in the language.",
    faq: [
      {
        question: "What is a repository's primary programming language?",
        answer: `It is the programming language with the most code lines in the repository's OctoCounts report. Data and prose formats such as ${DATA_FORMAT_EXAMPLES} are skipped when choosing it, so a repository that is mostly JSON by line count still belongs to the programming language it is written in.`,
      },
      {
        question: "How are repositories ranked inside a language?",
        answer: "By source lines of code in their report, largest first. Every report is counted with tokei under OctoCounts' canonical public options, which exclude tests, docs and generated directories, and is pinned to the commit that was counted.",
      },
      {
        question: "Why is a repository missing from these leaderboards?",
        answer: `A repository appears only if OctoCounts has a public report for it with at least ${MIN_INDEXABLE_REPORT_FILES} files, the language is its primary programming language, and it is among the largest of that language. A repository analyzed with custom counting options keeps those counts as a separate saved result; they never replace the public report these leaderboards read.`,
      },
    ],
    relatedLinks: RELATED_HUB,
  };
}

/// The model of /languages/:slug: the largest repositories of one language.
export function languageLeaderboardModel(page, index) {
  const language = page.language;
  const reports = page.reports;
  const top = reports[0];
  const runnerUp = reports[1];
  const columns = ["Rank", "Repository", "Code lines", "Total lines", "Files", `${language} share`];
  const share = (value) => `${Number(value).toFixed(1)}%`;
  const rows = reports.map((report, position) => [
    { text: String(position + 1) },
    { text: report.repoFullName, href: report.canonicalUrl },
    { text: formatNumber(report.total.code) },
    { text: formatNumber(report.total.lines) },
    { text: formatNumber(report.total.files) },
    { text: share(report.languageShare) },
  ]);
  const description = trimToLimit(
    [
      `The largest public GitHub ${language} repositories measured by OctoCounts, ranked by source lines of code. ${top.repoFullName} leads with ${formatNumber(top.total.code)} code lines.`,
      `The largest public GitHub ${language} repositories measured by OctoCounts, ranked by source lines of code.`,
    ],
    DESCRIPTION_LIMIT,
  );
  return {
    kind: "leaderboard",
    slug: page.slug,
    language,
    title: pageTitle(`${language} repositories by lines of code`, `${language} by lines of code`),
    heading: `The largest ${language} repositories by lines of code`,
    description,
    intro: `OctoCounts has measured ${formatNumber(page.repositories)} public GitHub repositories whose primary programming language is ${language}. ${top.repoFullName} is the largest, with ${formatNumber(top.total.code)} code lines across ${formatNumber(top.total.files)} files, counted with tokei on ${readableDate(top.generatedAt)}. The table ranks the ${formatNumber(reports.length)} largest by code lines; each row links to a report pinned to the commit it counted.`,
    columns,
    rows,
    afterTable: `Ranking rule: a repository belongs to ${language} when ${language} is its largest programming language by code lines; data and prose formats such as ${DATA_FORMAT_EXAMPLES} do not count as a language for this rule. "${language} share" is the share of the repository's code lines written in ${language}. Code lines exclude comments and blank lines. Every report uses OctoCounts' canonical public options, with tests, docs and generated directories excluded, and reports were generated on different dates.`,
    faq: [
      {
        question: `Which ${language} repository has the most lines of code?`,
        answer: `${top.repoFullName} is the largest ${language} repository in OctoCounts' index, with ${formatNumber(top.total.code)} code lines out of ${formatNumber(top.total.lines)} total lines across ${formatNumber(top.total.files)} files, counted on ${readableDate(top.generatedAt)}.${runnerUp ? ` ${runnerUp.repoFullName} follows with ${formatNumber(runnerUp.total.code)} code lines.` : ""} Code size is not code quality: a larger count only means more source material.`,
      },
      {
        question: `How does a repository join the ${language} leaderboard?`,
        answer: `${language} must be its primary programming language: the language with the most code lines in the repository's OctoCounts report, ignoring data and prose formats such as ${DATA_FORMAT_EXAMPLES}. The repository then needs a public report with at least ${MIN_INDEXABLE_REPORT_FILES} files, and it is listed when it is among the ${formatNumber(index.leaderboardSize)} largest by code lines.`,
      },
      {
        question: `How many ${language} repositories has OctoCounts measured?`,
        answer: `${formatNumber(page.repositories)} public GitHub repositories have ${language} as their primary programming language in OctoCounts' index. This page lists the ${formatNumber(reports.length)} largest by code lines; a repository analyzed with custom counting options keeps those counts as a separate saved result.`,
      },
      { question: "Does more source lines of code mean more complexity?", answer: COMPLEXITY_ANSWER },
    ],
    // The curated comparisons of this language, where the registry has
    // some: a reader of the Rust leaderboard can go on to Rust vs Go.
    comparisons: comparisonsForLanguage(language).map(entry => ({ slug: entry.slug, name: entry.name })),
    relatedLinks: [
      { href: LANGUAGES_PATH, label: "The largest codebases by programming language" },
      { href: "/docs/methodology", label: "How OctoCounts counts lines of code" },
      { href: "/hall-of-monoliths", label: "Hall of Monoliths: largest repositories by lines of code" },
      { href: "/docs/largest-codebases", label: "How many lines of code? The largest codebases, counted" },
      { href: "/docs/glossary", label: "SLOC and code metrics glossary" },
      { href: "/", label: "OctoCounts: count lines of code in any public GitHub repository" },
    ],
  };
}

/// The first candidate that fits the snippet, dropping detail in order.
function trimToLimit(candidates, limit) {
  return candidates.find((candidate) => candidate.length <= limit) ?? candidates.at(-1);
}

export function languagePageJsonLd(model) {
  const canonical = model.kind === "hub" ? `https://octocounts.com${LANGUAGES_PATH}` : `https://octocounts.com${LANGUAGES_PATH}/${model.slug}`;
  const items = model.kind === "hub"
    ? model.rows.map((row, index) => ({ "@type": "ListItem", position: index + 1, name: row[0].text, url: `https://octocounts.com${row[0].href}` }))
    : model.rows.map((row) => ({ "@type": "ListItem", position: Number(row[0].text), name: row[1].text, url: row[1].href }));
  const breadcrumb = model.kind === "hub"
    ? [{ "@type": "ListItem", position: 1, name: "OctoCounts", item: "https://octocounts.com/" }, { "@type": "ListItem", position: 2, name: "Languages", item: canonical }]
    : [{ "@type": "ListItem", position: 1, name: "OctoCounts", item: "https://octocounts.com/" }, { "@type": "ListItem", position: 2, name: "Languages", item: `https://octocounts.com${LANGUAGES_PATH}` }, { "@type": "ListItem", position: 3, name: model.language, item: canonical }];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#webpage`,
        name: model.title,
        description: model.description,
        url: canonical,
        inLanguage: "en",
        breadcrumb: { "@type": "BreadcrumbList", itemListElement: breadcrumb },
        mainEntity: { "@type": "ItemList", numberOfItems: items.length, itemListElement: items },
      },
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        mainEntity: model.faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })),
      },
    ],
  };
}
