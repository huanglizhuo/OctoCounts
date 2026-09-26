// Single source for the homepage FAQ, in both shipped languages.
//
// Three renderers consume this module and must never drift apart:
//   1. the visible FAQ section on the homepage (a real React section — SEO
//      content is user content, not crawler-only markup),
//   2. the FAQPage JSON-LD rendered inside that same React tree,
//   3. the build-time prerender (scripts/prerender-home.mjs renders the same
//      React tree, so it inherits both for free).
// The English texts are the exact strings the FAQPage JSON-LD in index.html
// carried before this module existed; the block moved here when the FAQ became
// real page content (the SPA shell keeps no FAQ of its own — every other route
// replaces the head's JSON-LD with its own).
//
// Answers are one self-contained string (schema.org Answer.text has no
// multi-paragraph type): long answers use internal blank-line breaks and the
// visible section splits them into <p> elements.

export type HomeFaqEntry = { question: string; answer: string };

export const HOME_FAQ: Record<"en" | "zh", HomeFaqEntry[]> = {
  en: [
    {
      question: "What is SLOC?",
      answer:
        "SLOC stands for Source Lines of Code. It is a software metric used to measure the size of a program by counting the lines in its source code. Unlike raw line count, SLOC distinguishes between code lines (actual instructions the compiler or interpreter processes), comment lines (documentation and explanations), and blank lines (whitespace). This breakdown matters because a 10,000-line file that is 40% comments tells a different story than one that is 95% code.\n\nDevelopers use SLOC to estimate project complexity, compare codebases when evaluating dependencies, scope billing and audit work, and communicate repository size to stakeholders who may not read code. OctoCounts reports SLOC at two levels: per programming language and as aggregate totals across the entire repository. The underlying counter is tokei, an open-source line counter written in Rust that processes files in parallel.",
    },
    {
      question: "Why use OctoCounts instead of cloning and running tokei locally?",
      answer:
        "OctoCounts downloads a compressed archive tarball rather than a full git clone with history. A git clone transfers every commit object, tree object, and blob in the repository's history; for a long-lived project that can mean hundreds of megabytes or gigabytes of data even if the current source tree is small. OctoCounts fetches only the archive of the working tree at the requested ref, so the transfer covers the current source tree instead of the repository's entire history.\n\nAdditionally, there is nothing to install. No git, no Rust toolchain, no tokei binary. Just paste a GitHub URL into the web app or install the browser extension once. Results are cached by commit SHA and tokei version, so any repeated analysis of the same commit returns instantly with zero re-download and zero re-processing. This makes OctoCounts especially useful for quickly evaluating dependencies or unfamiliar repositories without setting up a local environment.",
    },
    {
      question: "Does OctoCounts have a browser extension?",
      answer:
        "Yes. OctoCounts has browser extensions for Chrome, Edge, and Firefox, all named OctoCounts – GitHub SLOC & Code Statistics. Install from the Chrome Web Store, Microsoft Edge Add-ons, or Firefox Add-ons to add a compact SLOC card directly to GitHub repository sidebars. The card appears automatically on any public repository page and shows the total line count and analysis status. Clicking the card opens the full panel, which displays files, total lines, code lines, comment lines, and blank lines per language, the same breakdown as the web app.\n\nThe extension includes a local cache so results load instantly on repeat visits to the same repository and ref. You can configure the auto-analyze setting to fetch counts immediately on page load, or trigger analysis manually. The placement setting controls where the card appears in the GitHub sidebar. No GitHub account or API token is required. The extension source code is publicly available on GitHub.",
    },
    {
      question: "Is OctoCounts free to use?",
      answer:
        "Yes. OctoCounts is completely free to use for public GitHub repositories. There is no account required, no API key, no sign-up, and no rate limit that is publicly documented. Both the web app and the browser extensions are free with no premium tier. The backend is open source, written in Rust using the Axum framework, and the frontend is written in React with TypeScript. If you prefer, you can self-host the entire stack; the source code is available on GitHub at github.com/huanglizhuo/OctoCounts.\n\nOctoCounts intentionally analyzes public repositories only. It does not request GitHub account access, does not support private repositories, and does not accept source-code uploads. OctoCounts has no advertising and collects no personal data.",
    },
    {
      question: "What programming languages does OctoCounts support?",
      answer:
        "OctoCounts uses tokei for language detection, which supports over 200 programming languages and file types. Languages covered include Rust, Python, JavaScript, TypeScript, Go, Java, C, C++, C#, Ruby, Swift, Kotlin, PHP, Scala, Haskell, Elixir, Erlang, Clojure, F#, Lua, R, Julia, Dart, Perl, Shell, Bash, PowerShell, HTML, CSS, SCSS, SQL, GraphQL, Dockerfile, YAML, JSON, TOML, XML, Markdown, and many more.\n\ntokei detects languages primarily by file extension, with fallback to shebang lines and content-based detection for ambiguous files. It handles multi-language files and supports configuration to exclude specific directories such as node_modules, vendor, or build output folders. OctoCounts automatically skips heavy generated folders before passing the archive to tokei, which means the SLOC count reflects actual human-written source code rather than auto-generated files that would inflate the numbers.",
    },
    {
      question: "Can I export the source line count results?",
      answer:
        "Yes. OctoCounts supports three export formats available from the action buttons below the analysis results. Plain text copies a formatted table to your clipboard, showing language name, file count, total lines, code lines, comment lines, and blank lines in a column-aligned layout suitable for pasting into README files, GitHub issues, or documentation. JSON downloads the full structured report including per-language stats and aggregate totals, formatted for use in scripts, CI pipelines, or other tools that consume JSON.\n\nPNG downloads a 1200 × 630 image card showing the language breakdown, suitable for sharing on Twitter, LinkedIn, GitHub repository READMEs, or portfolio pages. The PNG card uses the same dark and light color palette as the web app and includes the repository name, total line count, and a language breakdown. All three formats are generated client-side from the analysis data already loaded in your browser, so no additional server request is needed.",
    },
    {
      question: "Does OctoCounts support private repositories?",
      answer:
        "OctoCounts supports public GitHub repositories only. It does not request GitHub account access, does not support private repositories, and does not accept source-code uploads. If you need to count lines of code in a private repository, run tokei locally. Download tokei from github.com/XAMPPRocky/tokei, clone your repository, and run tokei in the repository root. tokei is free, open source, and produces the same output format that OctoCounts uses.",
    },
  ],
  zh: [
    {
      question: "什么是 SLOC？",
      answer:
        "SLOC 代表源代码行数（Source Lines of Code），是一种通过统计源代码行数来衡量程序规模的软件度量指标。与原始行数不同，SLOC 区分代码行（编译器或解释器实际处理的指令）、注释行（文档与说明）和空行（空白字符）。这种细分很重要：一个 10,000 行、其中 40% 是注释的文件，和一个 95% 都是代码的文件，讲述的是完全不同的故事。\n\n开发者用 SLOC 评估项目复杂度、在选型依赖时对比代码库规模、估算计费与审计工作量，以及向不读代码的相关方传达仓库体量。OctoCounts 在两个层面报告 SLOC：按编程语言逐项统计，以及整个仓库的汇总合计。底层计数器是 tokei，一个用 Rust 编写、并行处理文件的开源行数统计工具。",
    },
    {
      question: "为什么用 OctoCounts，而不是本地克隆后运行 tokei？",
      answer:
        "OctoCounts 下载的是压缩归档 tarball，而不是带历史的完整 git 克隆。git 克隆会传输仓库历史中的每一个 commit、tree 和 blob 对象；对长期维护的项目来说，即使当前源码树很小，也可能意味着数百 MB 甚至数 GB 的数据。OctoCounts 只获取所请求 ref 对应工作树的归档，因此传输只覆盖当前源码树，而不是仓库的全部历史。\n\n此外，无需安装任何东西：不需要 git、不需要 Rust 工具链、也不需要 tokei 二进制。把 GitHub 链接粘贴进网页应用，或一次性安装浏览器扩展即可。结果按 commit SHA 和 tokei 版本缓存，重复分析同一提交会立即返回，零重复下载、零重复计算。这让你无需搭建本地环境，就能快速评估依赖或不熟悉的仓库。",
    },
    {
      question: "OctoCounts 有浏览器扩展吗？",
      answer:
        "有。OctoCounts 为 Chrome、Edge 和 Firefox 提供浏览器扩展，名称均为 OctoCounts – GitHub SLOC & Code Statistics。从 Chrome 应用商店、Microsoft Edge 加载项或 Firefox 附加组件安装后，GitHub 仓库侧边栏会直接出现一个紧凑的 SLOC 卡片。卡片在任何公开仓库页面自动出现，显示总行数和分析状态。点击卡片可打开完整面板，展示文件数、总行数、代码行、注释行、空行及各语言明细，与网页应用相同的统计口径。\n\n扩展内置本地缓存，重复访问同一仓库和 ref 时结果即时加载。你可以配置自动分析设置，在页面加载时立即获取计数，也可以手动触发。位置设置控制卡片在 GitHub 侧边栏中的显示位置。无需 GitHub 账号或 API 令牌。扩展源代码在 GitHub 上公开可用。",
    },
    {
      question: "OctoCounts 免费吗？",
      answer:
        "免费。OctoCounts 对公开 GitHub 仓库完全免费：无需账号、无需 API 密钥、无需注册，也没有公开文档记载的速率限制。网页应用和浏览器扩展均免费，没有付费层级。后端开源，使用 Rust 和 Axum 框架编写；前端使用 React 和 TypeScript 编写。如果你愿意，可以自行部署整套服务，源代码在 github.com/huanglizhuo/OctoCounts。\n\nOctoCounts 有意只分析公开仓库：不请求 GitHub 账号权限、不支持私有仓库、不接受源代码上传。OctoCounts 没有广告，也不收集个人数据。",
    },
    {
      question: "OctoCounts 支持哪些编程语言？",
      answer:
        "OctoCounts 使用 tokei 做语言检测，支持超过 200 种编程语言和文件类型，涵盖 Rust、Python、JavaScript、TypeScript、Go、Java、C、C++、C#、Ruby、Swift、Kotlin、PHP、Scala、Haskell、Elixir、Erlang、Clojure、F#、Lua、R、Julia、Dart、Perl、Shell、Bash、PowerShell、HTML、CSS、SCSS、SQL、GraphQL、Dockerfile、YAML、JSON、TOML、XML、Markdown 等等。\n\ntokei 主要按文件扩展名检测语言，对有歧义的文件回退到 shebang 行和基于内容的检测。它支持多语言文件，并支持配置排除特定目录，例如 node_modules、vendor 或构建产物目录。OctoCounts 在把归档交给 tokei 之前会自动跳过重型生成目录，这意味着 SLOC 计数反映的是实际由人编写的源代码，而不是会虚增数字的自动生成文件。",
    },
    {
      question: "可以导出源代码行数统计结果吗？",
      answer:
        "可以。OctoCounts 支持三种导出格式，可从分析结果下方的操作按钮使用。纯文本会把一张格式化表格复制到剪贴板，按列对齐展示语言名称、文件数、总行数、代码行、注释行和空行，适合粘贴到 README、GitHub issue 或文档中。JSON 下载包含各语言统计和汇总合计的完整结构化报告，适合脚本、CI 流水线或其他消费 JSON 的工具。\n\nPNG 下载一张 1200 × 630 的图片卡片，展示语言占比，适合分享到 Twitter、LinkedIn、GitHub 仓库 README 或作品集页面。PNG 卡片使用与网页应用相同的深浅配色，包含仓库名称、总行数和语言分布。三种格式均在浏览器端基于已加载的分析数据生成，无需额外的服务器请求。",
    },
    {
      question: "OctoCounts 支持私有仓库吗？",
      answer:
        "OctoCounts 仅支持公开 GitHub 仓库。它不请求 GitHub 账号权限、不支持私有仓库、也不接受源代码上传。如果你需要统计私有仓库的代码行数，请在本地运行 tokei：从 github.com/XAMPPRocky/tokei 下载 tokei，克隆你的仓库，然后在仓库根目录运行 tokei。tokei 免费开源，输出格式与 OctoCounts 使用的完全一致。",
    },
  ],
};

export function faqForLanguage(language: string | undefined): HomeFaqEntry[] {
  return language?.toLowerCase().startsWith("zh") ? HOME_FAQ.zh : HOME_FAQ.en;
}

/// FAQPage JSON-LD body for the homepage, in the page's language. Rendered by
/// the React FAQ section itself (a <script> tag inside the tree) so the
/// structured data and the visible answers share one source by construction.
export function faqPageJsonLd(language: string | undefined) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": "https://octocounts.com/#faq",
    mainEntity: faqForLanguage(language).map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/// Script-body form: JSON with every "<" escaped so a "</script>" inside any
/// answer can never terminate the tag early (same rule as the Pages Function's
/// escapeScriptJson).
export function faqJsonLdScript(language: string | undefined): string {
  return JSON.stringify(faqPageJsonLd(language)).replace(/</g, "\\u003c");
}
