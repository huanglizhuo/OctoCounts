# OctoCounts 增长与改进路线图

> 本文档记录所有增长建议与技术改进项及其实现方案,供后续(人或 AI agent)逐项实现。
> 每项包含:背景、实现方案、涉及文件、验收标准、优先级(P0 最高)与预估工作量。
> 实现任何一项前,先阅读 `PRODUCT.md`(品牌与设计原则)和 `how-to-run-and-deploy.md`(运行方式)。
>
> 技术栈速查:后端 Rust/Axum/SQLx/Postgres/tokei(`backend/`),前端 React/TS/Vite/TanStack Query(`frontend/`),
> 插件 MV3 原生 JS(`extension/`),部署 Docker Compose。生产域名:octocounts.com / api.octocounts.com。

---

## 状态总览

| # | 项目 | 类型 | 优先级 | 状态 |
|---|------|------|--------|------|
| 0.x | 落地页 badge builder / compare / diff / 分享卡 / 打字微演示 / 速度展示 / badge wall | 产品 | — | ✅ 已完成 |
| 1 | Programmatic SEO(报告页可索引) | 增长 | P0 | ✅ 已完成 |
| 2 | 动态 OG 图(每个报告链接一张卡) | 增长 | P0 | ✅ 已完成 |
| 3 | GEO / AI 搜索优化(llms.txt 等) | 增长 | P0 | ✅ 已完成 |
| 4 | 隐私友好 Analytics(增长前提) | 基建 | P0 | ✅ 已完成 |
| 5 | README 改造(GIF、主题展示、对比表) | 转化 | P1 | ⬜ |
| 6 | 插件内 GitHub Star 请求 | 增长 | P1 | ✅ 已完成 |
| 7 | Edge Add-ons 上架 | 渠道 | P1 | ⬜ |
| 8 | Launch 计划(Show HN / PH / 中文社区) | 渠道 | P1 | ⬜(非代码) |
| 9 | GitLab 支持一致性 | 产品 | P1 | ✅ 已决策:放弃 GitLab,收窄为 GitHub-only(方案 B) |
| 10 | GitHub Action(PR SLOC diff 评论) | 渠道 | P2 | ✅ 已完成 |
| 11 | npx CLI(`octocounts`) | 渠道 | P2 | ✅ 已完成 |
| 12 | MCP server(`octocounts-mcp`) | 渠道 | P2 | ✅ 已完成 |
| 13 | Hall of Monoliths 排行榜页 | 内容 | P3 | ✅ 已完成 |
| 14 | 大版本发布追踪内容 | 内容 | P3 | ⬜(半自动) |
| 15 | 商店 listing 优化 | 转化 | P3 | ⬜ |
| 16 | ChatGPT GEO 深化(compare/diff 收录修复、报告页 FAQPage、IndexNow、curated 对比页) | 增长 | P0/P1 | ✅ 已完成(TASK.md T05/T15/T21;采样监测 T22、站外证据 T23 待办) |

---

## 已完成(勿重复实现,仅供上下文)

- 落地页已有:Badge Builder(可选 9 种徽章类型 + copy markdown)、Compare Repos(`/compare`)、Ref Diff(`/diff`)、
  PNG 分享卡导出、`/github/:owner/:repo[/tree|commit/:ref]` 永久链接路由、en/zh 双语 i18n。
- 2026-07 本次会话完成:
  - 样例 chip 打字微演示:点击 `sample axum` 等会逐字打入 URL 并自动分析(`frontend/src/main.tsx` 的 `playSample`,
    尊重 `prefers-reduced-motion`;`useAnalysisRunner.runAnalysis` 支持 overrides 参数)。
  - 速度数字三处曝光:runner 头部 `… / cache hit / 194ms`、日志行 `counted N lines in Xms`
    (`reportUtils.ts logLines`)、Insights 新增 Speed 卡(grid 改为 3 列 ×2 行)。
  - Badge Wall:Badge Builder 下方实时徽章墙(`main.tsx BadgeWall`,3 个不同类型的真实徽章)。
  - 修复:进度条从 width/left 动画改为 transform(scaleX/translateX)。

---

## P0-1 Programmatic SEO:让每个报告页成为搜索落地页

**背景**:`/github/:owner/:repo` 永久链接已存在,但前端是纯 SPA,搜索引擎抓到的是空壳 HTML。
"X 项目多少行代码 / lines of code" 是真实查询类目,每个被分析过的仓库都应是一个免费落地页。

**实现方案**(后端为主):

1. **服务端 meta 注入**:在 Axum 增加路由拦截 `/github/:owner/:repo` 和 `/gitlab/...`(与前端路由同构),
   读取 `dist/index.html` 模板,若 DB 中有该 repo 的最新报告,替换/注入:
   - `<title>{owner}/{repo}: {total_lines} lines of code ({top_lang} {pct}%) | OctoCounts</title>`
   - `<meta name="description">`、canonical、OG/Twitter 标签(OG 图见 P0-2)、
     `application/ld+json`(`SoftwareSourceCode` 或 `Dataset` schema,含行数、语言分布)。
   - 无报告时返回默认模板(noindex 该情况可选)。
   - 注意:前端 `frontend/src/main.tsx` 里已有 `syncPageMetadata` 做客户端 title 更新,保留即可,服务端只负责首屏 HTML。
2. **Sitemap**:新增 `GET /sitemap.xml`(或按量拆分 sitemap index),数据源为 reports 表 distinct repo,
   `lastmod` 用最新 `generated_at`。在 `robots.txt` 声明。
3. **索引页**:新增前端路由 + 后端 API:
   - `/recent` 最近分析的仓库(去重,分页);
   - `/popular` 按分析次数排序(需要在 analyze 时给 repo 计数,可加列或独立表 `repo_stats`)。
   - 两页均服务端注入 meta,页内互链报告页,报告页页脚链回索引页(内链闭环)。
4. **正文可抓取(增强,可后做)**:meta 注入时同时在 `<body>` 里注入一个 `<noscript>`/隐藏语义块,
   包含语言表格的纯 HTML 版本,保证不执行 JS 也有正文可索引。

**涉及文件**:`backend/src/`(新 handler + sitemap 模块)、`frontend/src/main.tsx`(新增 /recent /popular 路由与组件)、
`docker-compose.yml`(确认 API 服务能读到前端 dist 或由 web 容器反代)。
**部署注意**:确认生产是谁在 serve 前端静态文件(看 `how-to-run-and-deploy.md` / compose 配置),
meta 注入路由必须部署在用户实际命中的那一层。

**验收**:`curl -A Googlebot https://octocounts.com/github/vitejs/vite | grep '<title>'` 返回含行数的标题;
`curl /sitemap.xml` 返回合法 XML;Search Console 提交后报告页开始收录。

**工作量**:2–4 天。

---

## P0-2 动态 OG 图:每条分享链接自带统计卡

**背景**:前端已有 1200×630 的 PNG 分享卡(`main.tsx ShareTickerCard` + html-to-image),但那是用户手动导出。
社交平台展开 `/github/owner/repo` 链接时应自动显示这张卡——每次分享都是一次品牌曝光。

**实现方案**(后端 Rust):

1. 新增 `GET /og/:owner/:repo.png`(可选 `?ref=`):
   - 读取该 repo 最新(或指定 ref)报告;
   - 用 Rust 侧渲染 1200×630 PNG。推荐 crate:`resvg` + `usvg`(SVG 模板填数据后栅格化,JetBrains Mono 字体
     文件已在 `frontend/public/fonts/`,打进后端镜像),比无头浏览器轻得多;
   - 视觉复刻 ShareTickerCard:终端窗口、Total LOC 大数字、code/comments/blanks 三列、top 语言条形;
     配色用 matrix 主题(截图传播时最有辨识度);
   - 无报告时返回一张通用品牌卡(不要 404);
   - `Cache-Control: s-maxage=86400`,按 commit 的可 immutable。
2. P0-1 的 meta 注入里 `og:image` 指向该 URL(`og:image:width/height` 一并给)。
3. badge API 已有的路由风格保持一致(参考 `backend` 中 badge handler 的缓存头做法)。

**验收**:把 `https://octocounts.com/github/tokio-rs/axum` 贴进 opengraph.xyz / X / Slack,预览显示统计卡;
冷仓库(未分析)显示品牌兜底卡。

**工作量**:2–3 天(SVG 模板调数字对齐是主要耗时)。

---

## P0-3 GEO:成为 AI 搜索回答"多少行代码"时的引用源

**背景**:用户问 ChatGPT/Perplexity "How many lines of code is React?" 时目前没有权威可引用源。
这类长尾问题的"标准数据源"位置目前空缺,抢占成本远低于传统 SEO。

**实现方案**:

1. `frontend/public/llms.txt`(以及可选 `llms-full.txt`):说明站点用途、数据方法(tokei、按 commit 缓存)、
   报告页 URL 模式、API 端点、badge 端点,给出示例。
2. `robots.txt` 明确允许 `GPTBot`、`ClaudeBot`、`PerplexityBot`、`Google-Extended` 等 AI 爬虫(至少不 block)。
3. 报告页提供**可直接引用的纯文本结论**:P0-1 的语义块里包含一句自然语言摘要,如
   "As of {date} (commit {sha}), {owner}/{repo} contains {lines} total lines: {code} code, {comments} comments,
   {blanks} blank, across {files} files in {n} languages (top: {lang} {pct}%). Counted with tokei via OctoCounts."
   ——AI 引擎最容易摘取这种 passage。
4. API 文档页(已有 `/docs/api`)顶部加同样的方法论说明,鼓励引用。

**验收**:llms.txt 可访问;用 Perplexity 问 3 个已收录仓库的行数,观察是否引用 octocounts.com(需 P0-1 收录后数周)。

**工作量**:0.5–1 天。

---

## P0-4 Analytics:先有漏斗,再谈增长

**背景**:后续所有动作都需要验证。当前无任何数据。

**实现方案**:

1. 选型 Plausible Cloud 或自托管 Umami(隐私友好、无 cookie banner 负担;`PRODUCT.md` 品牌上也不适合重型跟踪)。
2. 前端埋点(script 一行 + 自定义事件):`analyze_submitted`、`analyze_completed`、`badge_markdown_copied`、
   `png_exported`、`extension_store_click`(区分 chrome/firefox/edge)、`compare_run`、`sample_chip_clicked`。
3. 关键漏斗:落地 → 分析成功 → (badge copy | 商店点击);referrer 里单独盯 github.com(= badge 回流)。
4. 插件内**不加** analytics(商店审核与隐私声明成本高,收益低)。listing 转化用商店后台自带数据。

**验收**:仪表盘能回答:"badge 带来多少回流?" "web → 商店点击转化率多少?"

**工作量**:0.5 天。

---

## P1-5 README 改造(GitHub 是插件第一转化入口)

**背景**:`images/preview.png` 是通用圆角浅色卡片风,与 `PRODUCT.md` 的反参考(anti-reference)冲突;
README 缺少动图与"为什么不用 X"的回答。

**实现方案**:

1. **主预览换 GIF**:录制"打开 GitHub 仓库页 → 侧边栏出现 OctoCounts 卡片 → 数字填充"的 10 秒内循环 GIF
   (工具:任意录屏 + `gifski` 压制,控制在 5MB 内;或 `<video>` 标签用 mp4)。替换 README 的 `images/preview.png` 引用。
2. **双主题展示**:matrix / paper 两张并排截图(web 端)或循环 GIF,放"Preview"章节下。
   截图基线已有:`screenshots/` 目录。
3. **对比表**:新增"Why not just…"小节:

   | | OctoCounts | 本地 tokei/cloc | ghloc 等 |
   |---|---|---|---|
   | 无需 clone | ✅ | ❌ | ✅ |
   | GitHub 页面内直接显示 | ✅(插件) | ❌ | 部分 |
   | 按 commit 缓存、结果可复现 | ✅ | ❌ | ❌ |
   | README 徽章 / API | ✅ | ❌ | ❌ |
   | Compare / Diff | ✅ | ❌ | ❌ |

4. README 顶部第一屏保留现有 badge 演示(已做得好),把 Chrome/Firefox 安装徽章挪到 GIF 正下方(看完演示立刻可装)。

**验收**:README 首屏 3 秒内能看懂产品做什么、长什么样、怎么装。

**工作量**:1 天(主要是录制与压图)。

---

## P1-6 插件内 GitHub Star 请求

**背景与结论**:推荐做。用户 100% 是 GitHub 用户且插件就运行在 github.com 上,点 star 摩擦≈0。
文案必须符合品牌声线(terminal-native,不恳求),两家商店政策均允许(不得付费/功能诱导)。

**实现方案**:

1. **Footer 常驻链接(必做)**:`extension/src/popup/index.html:147` 的 footer(现有 `v0.4.x · privacy · report issue`)
   增加 `★ star` 链接 → `https://github.com/huanglizhuo/OctoCounts`。i18n 键加进 `extension/src/i18n` 的 en/zh。
2. **价值时刻一次性提示(转化主力)**:
   - 触发:content script 第 N 次(建议 N=4)成功渲染 SLOC 卡片后,在卡片底部插入一行可关闭提示;
   - 文案:en `// saved you a clone? star the repo →`,zh `// 省了一次 clone?给个 star →`;
   - 状态:`chrome.storage.local` 记 `successCount` 与 `starPromptDismissed`,关闭或点击后永不再显示;
   - 样式:复用卡片现有 CSS 变量,一行文字 + × 关闭钮,不做弹窗/动画。
3. **可选加分项**:footer star 链接旁显示 star 数(GitHub 匿名 API `GET /repos/huanglizhuo/OctoCounts`,
   `stargazers_count`,结果缓存 `chrome.storage` 24h,失败静默隐藏)。
4. **商店评分分流**:提示出现第二次机会留给商店评分——若用户点了 star 提示的关闭而非链接,
   在第 10 次成功后展示一次 `enjoying octocounts? rate it on the web store →`(同样一次性)。

**涉及文件**:`extension/src/popup/index.html|index.js|index.css`、`extension/src/content/`、`extension/src/locales/`。
**验收**:提示只出现一次;关闭后重启浏览器不再出现;卡片渲染不受影响;两家商店审核通过。

**工作量**:1 天。

---

## P1-7 Edge Add-ons 上架

**背景**:Chromium 内核,零代码改动即可多一个发现渠道。

**实现方案**:复用 Chrome 的 MV3 包(`extension/manifests/` 已按浏览器分 manifest,新增 edge 变体或直接用 chrome 包);
注册 Microsoft Partner Center,提交现有 `STORE_LISTING.md` 素材;README 与落地页(`frontend/src/constants.ts` 的
`extensionInfo`)增加 Edge 安装入口(落地页按 UA 显示对应商店按钮为加分项)。

**验收**:Edge 商店可搜到并安装;落地页/README 有 Edge 徽章。
**工作量**:0.5 天 + 审核等待。

---

## P1-8 Launch 计划(非代码,记录执行清单)

前置:P0-1/2/3 至少完成 OG 图与 meta(链接展开好看),analytics 就位。

1. **Show HN**:钩子用 compare 而非工具本身,标题方向:
   "Show HN: SLOC counts for any GitHub repo without cloning – I compared the major JS frameworks"。
   正文写动机(GitHub 只给百分比不给行数)、技术点(archive 下载 + tokei + commit 级缓存,Rust/Axum)、
   诚实列出局限(仅公共仓库等)。HN 重技术细节与诚实。
2. **Product Hunt**:同周不同日;素材用三主题截图 + GIF。
3. **中文社区**(双语是独特优势):V2EX(分享创造)、掘金、少数派;文案本地化而非翻译。
4. **Reddit**:r/webdev、r/rust(讲 Rust 后端实现)、r/github。
5. 每个渠道贴不同 UTM,launch 当天盯 analytics 与 API 负载(worker 队列已有,确认限流配置扛得住)。

---

## P1-9 GitLab 支持一致性

**背景**:README 标题写 "GitHub and GitLab",落地页 `parsePublicRepo` 也解析 gitlab.com,
但 hero 文案、badge 路由(`/badge/:owner/:repo` 只有 GitHub 语义)、插件(仅 github.com)不一致。
不一致读起来像失修。

**实现方案**(二选一,先做审计再决定):

- **A. 补齐并大声说出来**(若后端已能分析 GitLab archive):badge 路由加 `/badge/gitlab/:owner/:repo` 变体;
  报告永久链接已有 `/gitlab/` 前缀则打通;落地页 hero 与 README 明确 "GitHub & GitLab";
  插件 manifest 增加 gitlab.com content script(工作量大,可后置)。
- **B. 收窄口径**:若 GitLab 后端支持不完整,把 README 标题与落地页文案统一为 GitHub-only,
  GitLab 作为 roadmap 项写在 README 底部。

**第一步**:实测 `POST /api/analyze` 传 gitlab.com URL 的真实行为,按结果选 A 或 B。
**工作量**:B 0.5 天;A 2–4 天。

**决策(2026-07-04):选 B,放弃 GitLab。**
审计发现:后端 `backend/src/github.rs` 的 GitLab 代码路径完整(URL 解析/ref 解析/archive 下载),
但线上实测失败 —— 共享 reqwest client 把 GitHub 的 `Authorization: Bearer <GITHUB_TOKEN>` 发给了 gitlab.com,
GitLab 返回 401,被 `resolve_gitlab_ref` 的 `_ => NotFound` 兜底吞掉,用户看到 "not found / not public"。
决定不修复、不投入 GitLab,统一收窄为 GitHub-only。已完成的用户可见改动(方案 B):
- 前端拦入口:`main.tsx parsePublicRepo` 只接受 github.com;`parsePublicReportPath` 删 gitlab 分支;
  `analytics.ts providerFromRepoUrl` 去 gitlab;`functions/[[path]].js` 删 `/gitlab/*` SEO 路由(直接走 SPA)。
- 文案统一 GitHub-only:`index.html`(title/desc/keywords/OG/twitter/JSON-LD/FAQ,删 GitLab 专属 FAQ 两处)、
  `locales/en|zh.json`、`README.md`、`PRODUCT.md`、`docs/api.html`、`docs/github-sloc-counter.html`、`privacy.html`。
- 后端保留 dormant GitLab 代码与 DB `provider` 约束不动(无入口可触达,避免迁移风险)。

---

## P2-10 GitHub Action:PR 上自动评论 SLOC diff

**背景**:Marketplace 是独立发现渠道;PR 评论让全 team 看到品牌,而不只是装插件的人。

**实现方案**:

1. 新仓库 `octocounts-action`(JS action,`actions/github-script` 风格或直接 node20 runtime):
   - 输入:`github-token`(必需)、`ref-base`/`ref-head`(默认 PR base/head SHA);
   - 调用现有 API:对 base 与 head 各 `POST /api/analyze`(SHA 是 immutable,天然缓存友好),轮询 job,取报告;
   - 生成 markdown 评论:总行数变化、按语言 diff 表、底部 `— by [OctoCounts](https://octocounts.com)`;
   - 用 hidden HTML comment 标记做 upsert(更新既有评论而非刷屏)。
2. 发布到 GitHub Marketplace,README 给 3 行接入示例。
3. 注意:API 需确认对 CI 来源的限流策略(按 IP 的限流对 GitHub runner 不友好,考虑给 action 一个共享 App token
   或放宽 SHA 精确命中缓存时的限流)。

**验收**:在 OctoCounts 仓库自 dogfood:开 PR 自动出现 SLOC diff 评论且后续 push 更新同一条评论。
**工作量**:2–3 天。

---

## P2-11 npx CLI

**背景**:`npx octocounts vitejs/vite` 零安装心智;npm 是又一个搜索入口。

**实现方案**:新仓库或 monorepo 子包 `cli/`,Node 单文件:
参数解析(repo、`--ref`、`--json`)→ 调 `api.octocounts.com` → 终端渲染
(复用 `frontend/src/reportUtils.ts textReport` 的对齐格式,加 ANSI 颜色,尾行打印报告 URL)。
包名 `octocounts`,`bin` 字段,无依赖或仅 `picocolors`。发布后 README 增加 CLI 用法节。

**验收**:`npx octocounts tokio-rs/axum` 10 秒内输出彩色表格与链接。
**工作量**:1 天。

---

## P2-12 MCP server

**背景**:AI 编程工具(Claude Code/Cursor 等)用户与目标用户完全重合;MCP 目录是新且低竞争的分发渠道。

**实现方案**:新包 `octocounts-mcp`(TypeScript,官方 `@modelcontextprotocol/sdk`,stdio transport):

- tools:
  - `analyze_repo(repo_url, ref?)` → 返回结构化报告(直接透传 API JSON,附 report 页 URL);
  - `compare_repos(left, right)` → 两份报告 + 计算差值;
- 无需 API key(公共 API);README 写 Claude Code / Cursor 一行接入配置;
- 提交到主流 MCP 目录(mcp.so、官方 registry 等)。

**验收**:Claude Code 配置后能回答"这个仓库多少行代码"并给出 octocounts 链接。
**工作量**:1–2 天。

---

## P3-13 Hall of Monoliths 排行榜

**背景**:天然 HN/Reddit 素材与外链磁铁,数据已全在 DB。

**实现方案**:后端加聚合端点(最大代码行 TOP 50 / 语言数最多 TOP 50 / "weekend-devourer" 指数),
前端新路由 `/hall`,终端风格排行榜,每行链接报告页;页面服务端注入 meta(依赖 P0-1 基建);
防刷:仅收录 stars 或分析次数达阈值的仓库,或人工白名单起步。

**工作量**:1–2 天。

---

## P3-14 大版本发布追踪内容(半自动)

**背景**:大项目发版时"代码量变化"有天然话题性,`/diff` 功能就是现成答案。

**实现方案**:维护一个关注列表(React、Linux、Vue、Rust 等);发版时用 `/diff?repo=…&base=vX&head=vY`
生成结果,配 OG 图(P0-2)发推/发帖。可写一个脚本轮询 GitHub releases RSS 提醒,但发帖保持人工(质量>数量)。

**工作量**:脚本 0.5 天,其余是持续运营。

---

## P3-15 商店 listing 优化

**实现方案**:`extension/STORE_LISTING.md` 基础上:
截图第一张换成"GitHub 页面内的卡片"实景(带浏览器框);增加三主题截图;
Chrome 商店支持的 promo 视频位放 README 同款 GIF;
描述首句直接给结论式卖点("See actual line counts on every GitHub repo — no clone.");
中文商店描述同步(已有 zh locale 能力)。

**工作量**:0.5–1 天。

---

## 依赖关系与建议实施顺序

```
P0-4 analytics ─┐
P0-1 SEO 基建 ──┼─→ P1-8 Launch ─→ P2-10 Action / P2-11 CLI / P2-12 MCP ─→ P3-*
P0-2 OG 图 ─────┤
P0-3 GEO ───────┘
P1-5 README / P1-6 Star 请求 / P1-7 Edge / P1-9 GitLab 一致性:与 P0 并行,无依赖
```

原则:P0 四项让"每一次分享和搜索都持续回流";P1-8 负责点火;P2 每项都是独立分发渠道,
launch 验证需求后再投入;P3 是持续的内容飞轮。
