# SEO/GEO 第 7 轮：口径一致性、报告长尾的发现结构、枢纽页与落地页（2026-11-24）

- 触发：2026-11-23 的全站复查。本文件记录复查结论、本轮改动、验证结果和仍未关闭的事项。
- 关联文档：[seo-geo-history.md](seo-geo-history.md)（第 1–5 轮）、[seo-index-runbook.md](seo-index-runbook.md)（部署与观察）、[ai-crawling-policy.md](ai-crawling-policy.md)（爬虫与 API 主机策略）。

## 一、复查结论（2026-11-23 线上实测）

实测范围：79 个 URL（静态 sitemap 全部 35 个、集合页、20 个对比页、24 个报告页），19 种搜索与 AI 爬虫 UA，API 子域，集合分页，4 个页面的移动端 Lighthouse，报告目录的规模分布。

技术底座没有硬伤：全部 URL 返回 200、自引用 canonical、单一 H1；线上 `robots.txt` 与仓库一致；19 种爬虫 UA 都拿到 200 的 HTML 且没有 Cloudflare 挑战页；JSON-LD 全部可解析；Markdown 孪生带 `noindex, follow`；Lighthouse 移动端性能为首页 100、文档页 100、报告页 97、对比页 92（实验室数据，单次）。

11/19 审计列出的 6 项工程问题和 10/16 的 seed 轮转均已在此前修复。本轮处理的是复查新发现的问题。

| 优先级 | 发现 | 证据 |
|---|---|---|
| P1 | 对外内容的默认统计口径是旧的 | 报告页、README 和 API 文档说 canonical 默认排除 docs/tests/generated（17 个目录名）；方法论页（中英）、SLOC 主指南、FAQ、count-lines 指南、cloc 对比指南、`llms.txt`、`llms-full.txt` 和事实表只写默认跳过 8 个依赖/构建目录，或写成由调用方选择 |
| P1 | API 主机没有索引边界 | `api.octocounts.com/robots.txt` 返回 404；JSON、徽章、分享图响应没有任何索引指令。11/19 的 506 条“已抓取未收录”里 176 条是 SEO 报告 JSON、119 条是徽章 |
| P1 | 报告页模板 | 服务端 HTML 没有指向 GitHub 仓库的可见链接（仓库地址只在 JSON-LD 和内嵌 JSON 里），没有 `<main>`；长仓名的标题和描述超出摘要宽度（24 个抽样中 3 个标题超过 60 字符、5 个描述超过 160 字符）；冷渲染 TTFB 1.2–1.6 秒且无法归因 |
| P2 | 报告长尾缺少稳定入口 | 10,227 个报告页靠一个 sitemap 和每天 64 条轮换链接，一个报告约 160 天才轮到一次站内链接；抽样的 24 个报告页中 23 个没有站内入链。GSC（11/16 数据）为 1,042 已收录、8,279 已发现未收录 |
| P2 | 榜单页质量 | `/popular` 按打开次数排序，前 3 名是维护者自己的仓库；`/hall-of-monoliths` 混入内核拷贝（`ARARAT33/AWEOS` 的语言构成与 torvalds/linux 几乎相同）和数据文件仓库（`jaredpalmer/kev` JSON 99.9%） |
| P2 | 对比页互不链接 | 101 个对比页每个只从 `/compare` 目录和两侧报告页获得入链；全部共用站点通用分享图 |
| P2 | 三个产品没有站内页面 | CLI、MCP server、GitHub Action 只能从首页链到 GitHub 源码目录；`/cli`、`/mcp`、`/action` 返回 404；`llms.txt` 完全没有提及 |
| P3 | 小项 | 工具对比指南标题带 “(2026)”；`/diff` 服务端只有一句话；`/contact` 把单一维护者写成 “team”；`/research`、`/about`、`/docs`、`/contact`、`/privacy` 没有浏览器缓存规则；两个 Linux 行数（10 月与 11 月）没有互相说明；静态文档更新不会自动推送 IndexNow |

## 二、改动

### P1

| 项 | 实现 |
|---|---|
| 默认口径 | 方法论页（中英）、SLOC 主指南（中英）、API、FAQ、count-lines 指南、cloc 对比指南、`llms.txt`、`llms-full.txt` 改为同一口径并列出 17 个目录名。API 文档的首个示例不再显式开启全量口径。事实表 `product-facts.json` 新增 `defaultScope`，检查脚本从 `backend/src/analyzer.rs` 推导目录清单，断言所有解释默认规则的文件都含有口径声明和完整目录名，并拒绝旧措辞 |
| API 索引边界 | 后端新增 `index_policy.rs`：机器可读响应带 `X-Robots-Tag: noindex`；报告 JSON 用 canonical `Link` 指向 HTML 页（薄报告和带 ref 的查询没有唯一规范页，改为 noindex）。`api.octocounts.com/robots.txt` 全放行，只排除写操作和逐请求的任务状态。失败响应不带指令，故障不会导致去索引 |
| 报告页模板 | 引用下方加 “Source” 链接（仓库和精确提交），服务端 HTML、Markdown 孪生和客户端渲染一致，URL 由报告自身的身份构造。边缘渲染的正文放进 `<main>`。标题在超长时去掉品牌后缀，描述按“文件数、主语言、口径说明”的顺序让位。报告响应带 `Server-Timing`（report、related、render） |

### P2

| 项 | 实现 |
|---|---|
| 数据模型 | `reports` 新增两个物化列：`stars`（分析时的 GitHub star 数）和 `primary_language`（最大的编程语言，跳过数据与文档格式）。由现有统计触发器推导，并为 canonical 行做键集分页回填。回填只更新这两列，不触发缓存清理 |
| `/popular` | 按 stars 排序，访问活跃度只作平手裁决。生产只读采样（2026-11-24）：10,362 个可索引仓库全部带有 star 数，≥ 1,000 星的 3,819 个 |
| `/hall-of-monoliths` | 排除最大语言为数据格式的仓库；100 万行以上、同语言、行数相差 2% 以内的两个仓库只保留 star 较多的一个。两个榜单都只列 GitHub 仓库（站点没有 `/gitlab` 路由） |
| 报告 sitemap | 按层拆分：`sitemap-reports-core-N.xml`（≥ 1,000 星）和 `sitemap-reports-tail-N.xml`（其余）。索引视图描述分片，分页视图接受 `tier`。旧的未分层文件和旧版 API 的纯日期索引仍然可用；其它 sitemap 形态的 URL 返回 404 |
| 语言榜单 | `/languages` 列出有榜单的每种语言；`/languages/:slug` 排出以该语言为主语言的最大仓库。一个模型（`functions/language-pages.js`）同时驱动边缘 HTML、Markdown、JSON-LD 和客户端 React 页面。语言需要至少 10 个仓库才有页面，每页最多 50 个。`sitemap-languages.xml` 列出枢纽页和全部榜单页 |
| 对比页 | 每页链接与之共享仓库的对比（最多 6 个），并使用自己的分享图（`GET /og/compare`） |
| 工具落地页 | `/docs/cli`、`/docs/github-action`、`/docs/mcp-server`（HTML 与 Markdown）。内容只陈述 CLI 帮助文本、MCP 工具定义和 `action.yml` 里有的事实。首页工具卡、FAQ、文档中心和两个 llms 文件都链接到这些页面 |

### P3

| 项 | 实现 |
|---|---|
| `/diff` | 说明净变化规则、基数为零的规则和两侧如何计数，加 FAQ；服务端 HTML、客户端页面和 FAQPage schema 同源（`functions/diff-copy.js`） |
| 标题一致性 | `/compare` 和 `/diff` 的客户端 H1 改为与服务端一致（此前客户端是 “Compare Repos” 和 “Ref Diff”） |
| 文案 | 工具对比指南去掉年份；`/contact` 写明单一维护者，并说明报告计数看起来不对时该提供什么；`/privacy` 描述补全；集合页描述用满摘要宽度；`/popular` 和 Monoliths 的英文、中文说明改为 stars 排序和新排除规则 |
| 缓存 | `/docs`、`/research`、`/about`、`/contact`、`/privacy` 和 `llms-full.txt` 获得 `/docs/*` 已有的一小时浏览器缓存 |
| IndexNow | 后端每天读取站点自己的三个核心 sitemap 并提交其中的 URL（全集群每天一次）。旧规则拒绝根路径，现已允许首页 |
| Linux 数字 | 仓库体积指南指向 largest-codebases 的 11 月测量，并说明两者口径不同 |

## 三、验证

- 前端：`npm test` 通过（CSP 哈希、78 项单元测试、产品事实检查 63 个文件、构建、160 项 SEO 测试、资源预算）。预算：首页 JS 157.5/165 KiB，报告页 187.0/200 KiB，工具页 168.9/175 KiB。
- 浏览器：`npm run test:qa` 93 项通过。另对 `/languages`、`/languages/rust`、`/compare/react-vs-vue`、`/diff` 做了 Chromium 冒烟检查（真实边缘函数产出服务端 HTML，加生产构建的资源）：水合后的页面保留标题、表格、FAQ 和相关链接，H1 与 `<main>` 各一个，1280px 和 390px 都没有横向溢出，没有页面错误。
- 后端：`cargo fmt --check`、`cargo clippy --all-targets --locked -- -D warnings` 通过；`cargo test --locked` 在带 PostgreSQL 的本地实例上 286 项通过，另有 1 项独立测试通过。两个 golden 文件按预期只减少了旧数据里的 GitLab 行。
- 以上是本地验证。生产部署后的冒烟检查见 runbook。

## 四、未做与遗留

| 项 | 说明 |
|---|---|
| 站外品牌提及 | 复查时确认：HN 只有一篇 2 分的帖子，Stack Overflow 0 提及，Product Hunt 无条目；tokei 的 PR #1371 和 awesome-browser-extensions 的 #239 都没有回应；badge 第三方采用 35 个仓库，其中 23 个来自同一个组织。这些动作需要在第三方站点以维护者身份进行，本轮没有代为发布 |
| Cloudflare JavaScript Detections | Cloudflare 注入的内联脚本被站点的哈希式 CSP 拦截，每次页面加载报一条控制台错误，对抓取没有影响。需要在 Cloudflare 控制台关闭该功能，或改用 nonce 式 CSP；两者都不是仓库改动 |
| Dataset 许可 | 仍待产品决定数据集的许可范围 |
| 公开转私有的下架流程 | 仓库由公开转为私有后，已保存的公开报告没有自动下架路径，仍是开放问题 |
| SG-10 度量 | GSC、Bing、umami 基线仍为未知；`docs/chatgpt-geo-baseline.csv` 的结果字段为空 |
| 中文覆盖 | 仍是 3 个页面 |
| 提高收录门槛 | 报告页的收录门槛（5 个文件）没有改。门槛以下的页面会直接 404，属于产品决策；先观察分层 sitemap 和语言榜单的效果 |

## 五、复查清单

部署后立即：

- `/sitemap.xml` 列出 `sitemap-languages.xml`、`sitemap-reports-core-1.xml`、`sitemap-reports-tail-1.xml`；旧的 `/sitemap-reports-1.xml` 仍返回 200。
- `/languages` 和若干 `/languages/:slug` 返回 200，含标题、表格和 FAQ；`/languages/unknown` 返回 404。
- `/popular` 首屏不再是维护者自己的仓库；`/hall-of-monoliths` 不再出现内核拷贝和数据文件仓库。
- 任意报告页含 “Source: owner/repo on GitHub” 链接和 `<main>`；响应带 `server-timing`。
- `https://api.octocounts.com/robots.txt` 返回 200；`/api/stats` 带 `x-robots-tag: noindex`；`/api/seo/report?...` 带 canonical `link`。
- `/docs/cli`、`/docs/github-action`、`/docs/mcp-server` 返回 200。
- `/compare/react-vs-vue` 的 `og:image` 指向 `/og/compare`，该 URL 返回 PNG。

两到四周后：

- GSC 按 sitemap 分别记录 core 与 tail 的已收录、已发现未收录数量，与 11/19 的全站基线比较。
- 记录 `/languages` 及各榜单页的收录数量和曝光。
- 重新采样报告页冷渲染的 `server-timing`，判断 1 秒以上的耗时落在哪一段。
- 11/26 的 GSC 复查（`docs/seo-audit-2026-11-19/indexing-baseline.md`）照常执行。
