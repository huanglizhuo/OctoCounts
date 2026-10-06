# OctoCounts 全站 SEO 审计报告

- 站点: https://octocounts.com/
- 日期: 2026-10-07
- 业务类型: SaaS / 开发者工具(免费 Web 工具 + Chrome/Edge/Firefox 扩展)
- 规模: 24 静态页 + 97 compare 页 + 4481 报告页(/github/:owner/:repo)
- 方法: 10 个专项并行审计(技术/内容/Schema/Sitemap/性能/视觉/GEO/SXO/外链/主题聚类),证据来自 live 抓取、Lighthouse 移动端实验、Common Crawl、HN Algolia、SERP 检查、Playwright 截图

## 综合健康分:83 / 100(站内)

| 类别 | 权重 | 得分 |
|---|---|---|
| 技术 SEO | 22% | 88 |
| 内容质量 | 23% | 78 |
| On-Page | 20% | 85 |
| Schema | 10% | 88 |
| 性能 (CWV) | 10% | 90 |
| AI 搜索就绪 (GEO) | 10% | 73 |
| 图片/视觉 | 5% | 82 |

**站外权威(未计入上表):外链 12/100 —— 这是当前最大的增长瓶颈。**

Lighthouse 移动端:Perf 94,LCP 2.6s(边缘),CLS 0,TBT 40ms。全部页面 SSR、自 canonical、安全头齐全、OG 图合格(1200x630/68KB)。

---

## 1. 技术 SEO(88)

通过:HTTP→HTTPS 与 www→apex 重定向干净;404 为真 404 + noindex + 品牌页;HSTS 2y+preload、CSP、XFO、COOP 全套;边缘缓存 + SWR;HTTP/2+h3;报告页完全 SSR(无 JS 依赖);sitemap 三件套有效、抽样 100% 200 且 canonical 精确匹配。

- **[HIGH]** `/compare/react-vs-vue`、`angular-vs-react`、`svelte-vs-react`、`docker-vs-podman` 持续 503(5 分钟内 3 次重试),但这些 URL 在 sitemap-compare.xml 里且被全站报告页侧边栏链接。原因(代码级):`frontend/functions/[[path]].js` 页面渲染在"后端不可用/仓库完整性守卫"时走 `serviceUnavailableResponse`(~L1253/1496),而 sitemap 的 `indexableCompareEntries` 失败时放行(~L1526)——同一份数据两个消费方不一致。修复:渲染与 sitemap 共享存在性判断,或对 registry 对缓存 last-good SSR。
- **[MEDIUM]** `.md` 与 `?format=md` 变体返回 200 `text/markdown`,无 canonical 也无 `X-Robots-Tag`(markdown 无 head)→ 可被索引的重复内容。修复:对 `*.md`/`?format=md` 响应加 `X-Robots-Tag: noindex`(边缘一条规则)。
- **[MEDIUM]** 4481 报告页中约 4400 个仅靠 sitemap 可发现(站内 /github/* 内链约 60 个)→ 无链接权重、抓取深度差。修复:按 owner 的可浏览索引页或"相关报告"轮换。
- **[LOW]** `sitemap-reports-2.xml` 返回 200 但 urlset 为空且未被索引引用——死产物,空时不输出。
- **[LOW]** `/github/facebook/react`→308(组织改名)处理正确但 CF 缓存 BYPASS,每次回源;可加 308 缓存规则。

## 2. 内容质量(78)

通过:无薄页(最短 /about 310 词,首页 1704 词);每页有日期;/research 是真原创研究(n=2 局限如实披露 + JSONL 数据下载);methodology 固定 tokei 版本、缓存键、引用模板;报告页引用块自带日期+commit SHA = 高 AI 可引用性。

- **[HIGH]** 关键词蚕食:`/docs/github-sloc-counter`(635 词)与 `/docs/count-lines-of-code-github`(649 词)约 60% 实质重叠(同样的计数流程描述、同一张 5 行指标表、同款计数 FAQ)。修复:前者砍掉"计数原理"部分做成产品/功能页,how-to 意图全归后者。
- **[MEDIUM]** 三页重复工具评语:cloc/tokei/scc 的几乎相同结论同时出现在 best-sloc-counter-tools、octocounts-vs-cloc、tokei-online。
- **[MEDIUM]** 引擎版本矛盾:methodology 写 tokei 14.0.0(2026-08-29 核验),research 页写 tokei-12.1(2026-09-08 采集)——站点卖的就是可复现性。修复:加一句版本钉定说明或用 14.0.0 重跑。
- **[MEDIUM]** 零外部引用:全站不链 cloc/tokei/scc 仓库或任何一手来源("cloc since 2006"、COCOMO 均无出处)。
- **[LOW]** 报告标题歧义:"react/react: 365,008 lines of code" 实为排除测试后的 code 行(总数 460,770),与首页默认口径不同;标题应写 "code lines" 并注明配置。
- **[LOW]** "Similar repository reports" 把无名小仓库列为 React 的体量相似对象;过滤或去掉。

## 3. Schema(88)

通过:首页 6 块 JSON-LD 全部有效(WebApplication/WebSite+SearchAction/Organization/SoftwareApplication/Person/FAQPage);报告页 @graph 含 Dataset+SoftwareSourceCode+BreadcrumbList+FAQPage(4481 页全有,质量高:identifier、measurementTechnique、variableMeasured、DataDownload);docs 有 TechArticle+speakable;/trending 有 CollectionPage+ItemList。FAQ 富结果 2023 起仅限政府/医疗——不影响,AI 解析价值仍在。

- **[MEDIUM]** /trending `"publisher": "https://octocounts.com/#organization"` 裸字符串,应为 `{"@id": ...}`。
- **[LOW]** Person `@id` 各页 sameAs 不一致(首页只有自身,docs/compare 页有 npm/商店);统一为一份规范 Person 块。
- **[LOW]** /compare、/trending 把 BreadcrumbList 嵌在 WebPage 内(docs/报告页是独立顶层,后者才是 Google 文档模式)。
- **[LOW]** 首页 SoftwareApplication#extension 的 url/downloadUrl 只指向 Chrome 商店,而 operatingSystem 列了 Edge/Firefox。
- **[LOW]** Dataset dateModified 带纳秒精度小数秒;截到毫秒。

## 4. Sitemap(78)

通过:xmllint 全过;无 priority/changefreq 噪音;lastmod 真实分布(09-06→10-06);抽样 48 URL 全 200、canonical 精确;边缘实时生成 + 1h 缓存,新报告 ~1h 内入图;有质量门(URL 形状、去重、MIN_INDEXABLE_REPORT_FILES=5);gzip 后 67KB。

- **[HIGH]** 即 §1 的 503 问题:4/10 抽样 compare 页持续 503 仍在图中(marquee 页 react-vs-vue 最伤)。
- **[MEDIUM]** compare 页模板重:两页 52% token 重叠(<60% 独创性线),30+ 模板页有站群风险;curated registry + 真实缓存数据是缓解项。每对加独特叙述(架构、历史)。
- **[LOW]** 97 个 compare lastmod 全为同一常量(2026-09-17);改用每对的报告刷新日期。
- **[LOW]** 仓库改名/删除无法被质量门捕获(代码内已注明 L1876);加定期 live-name 复核。
- [LOW] ~~`/api/seo/recent` 返回 404~~ **勘误(2026-10-07)**:该端点实际存在(`backend/src/main.rs:161`,live 200),sitemap 审计 agent 误报,llms.txt 无需修改。

## 5. 性能(90,Lighthouse 移动端 + curl)

Perf 94 / FCP 2.2s / **LCP 2.6s(边缘)** / TBT 40ms / CLS 0。文档页 14.6KB 零外部请求;字体 preload+swap;图片全有宽高;hashed 资源 immutable。

- **[MEDIUM]** 报告页 LCP 元素是 `api.octocounts.com/og/...` 的 39KB 跨域 PNG,冷加载 ~1.0s,无 fetchpriority/preload。修复:转 WebP/AVIF(约省 60%)、`fetchpriority="high"`、或经 CF 同域镜像。
- **[MEDIUM]** 首页移动端 LCP 2.6s 贴线;压缩后 JS 共 ~304KB(含 vendor-react 194KB)+ 79KB CSS。修复:内联关键 CSS、清 11KB 未用 CSS 即可过线。
- **[LOW]** 未用 JS 24KB / CSS 11KB;下次构建加 PurgeCSS/tree-shake。

## 6. 视觉/移动端(82,截图在 screenshots/)

通过:两尺寸首屏都完整呈现 H1+输入框+ANALYZE;移动端零横向滚动、正文 15-16px、CTA 全宽;OG 图 1200x630/68KB 合格且信息清晰。

- **[MEDIUM]** 首屏无任何量化社会证明(无 GitHub 星数、无"已分析 N 个仓库"、无商店评分)。
- **[MEDIUM]** 移动端行内链接("try: react/vscode/..."、页脚/导航)实测高 36px(<44px 建议)。修复:min-height 44px。

## 7. GEO / AI 搜索就绪(73)

通过:robots.txt 放行全部 AI 爬虫 + Content-Signal;llms.txt 结构正确;ClaudeBot/GPTBot UA 抓取与正常 UA 完全一致(Cloudflare 无挑战);报告页有可整段摘引的句子("react/react has 365,008 source lines of code out of 460,770 total… by tokei… on 2026-10-03");sitemap lastmod 新鲜(Perplexity 友好);vs-cloc 页有干净的定义句与对照表。

- **[CRITICAL]** **未进 Bing 索引**(site: 查询返回全无关填充结果)→ ChatGPT Search 依赖 Bing,站点在那里实际不存在。修复:Bing Webmaster Tools + 提交三个 sitemap + IndexNow 新报告,约 1 小时。
- **[HIGH]** 第三方品牌提及接近零(无 Reddit/HN 有效帖/PH/listicle)——AI 引用与提及量强相关,这是 GEO 的根本约束。
- **[HIGH]** llms-full.txt 过期(09-16)且缺 MCP server、CLI(`npx octocounts`)、GitHub Action、/compare、/diff 章节——MCP 恰是 agent 最常查询的面。重新生成 ~30 分钟。
- **[MEDIUM]** "tokei online" 意图无人应答(tokei 无官方 web UI,SERP 全是钟表噪音);在两个 docs 页加一段 "OctoCounts 在线跑 tokei" 即可认领。
- **[LOW]** llms.txt(09-17)与 llms-full.txt(09-16)日期不同步。
- 剔除一条误报:该 agent 称首页缺 SoftwareApplication/Organization schema——与直接抓取结果矛盾(6 块俱在),已排除。

## 8. SXO / SERP 意图匹配(69)

SERP 实测:"github sloc counter" 前排是 GitHub 仓库页(本站 #8);"count lines of code github" 被 how-to 教程 + git 命令 gist + codetabs 工具页占据,本站缺席;"lines of code counter online" 9/9 是粘贴文本工具页;"cloc alternative online" 被 libhunt/alternativeto 占据;"tokei online" 全是钟表/手表——零竞争;"sloc extension github" 本站 #8。

- **[CRITICAL]** 最高意图词 "count lines of code github" 需要的是 how-to 页,不是工具页。发布 "4 种方法统计 GitHub 仓库代码行数"(clone+cloc / 在线工具 / 扩展 / API),OctoCounts 作方法之一。
- **[HIGH]** best-sloc-counter-tools 打不过 libhunt 的 DA:加带数据(各工具星数、最后提交日期)的对比表,拆出 vs-cloc / vs-tokei / vs-scc 子页,首页互链。
- **[HIGH]** "clone 前先看仓库多大" 意图无页面承接(仓库磁盘体积 vs SLOC)——用现有 API 数据做页。
- **[MEDIUM]** 首页扩展区加商店评分/安装量/侧栏截图("sloc extension github" 排 #8 输在商店镜像展示了安装数)。
- 人像打分:快速计数开发者 87/100 服务最好;**研究者 47/100 最差**(无批量/组织级统计入口、导出与 API 未在首页露出);EM 对比 60/100(Compare 埋在导航里无演示)。

## 9. 外链(12/100)

事实:repo 2026-05-01 创建,14 星;已知入链全部自建(自家 repo nofollow、自家 dev.to、cutestat 自动档案);HN Show HN(2026-07-16)仅 2 分 0 评论;Reddit 零提及;无第三方编辑性链接。

- **[CRITICAL]** 域权威处于冷启动期,这是所有排名问题的公共根因。
- 最高杠杆动作(按序):① Product Hunt + AlternativeTo(对 cloc/SLOCReport 的 alternative 条目)+ DevHunt/Uneed;② awesome-list PR(analysis-tools-dev/static-analysis 13k★;tokei README "similar tools" 区);③ Reddit r/commandline、r/rust、r/SoftwareEngineering——用 /research 数据发现开头,不放产品链接开头;④ 以 "X% of React 是测试代码" 类研究钩子重发 Show HN;⑤ listicle("sloc counter"、"cloc alternative") pitch 收录。
- **Badge 飞轮未用**:badge 目前只出现在自家 repo;在报告页加 "copy badge" 流程,每个外部 repo 嵌入 `api.octocounts.com/badge/:o/:r` 都是一个发现面。

## 10. 主题聚类(62)

现状:10 个 docs 页中 "github-sloc-counter" 有 hub 之名无 hub 之实(不链 count-lines/tokei-online/language-bar),而 count-lines 反而出链最多(7)——两个准 hub 竞争;count-lines、tokei-online、glossary 各只有 1 个入链(准孤儿);methodology 9 入链 0 出链(PageRank 汇但不分配);/trending、/stats 无任何 docs 页链接;报告页仅 2/10 docs 引用。

- 修复:github-sloc-counter 定为唯一 hub,加 9-spoke 索引块;全 docs 加 "相关指南" 块救孤儿;每篇 docs 链 1-2 个示例报告页。
- 缺口词(按优先):COCOMO 计算器(glossary 提了 10 次却无页)、cloc online(镜像 tokei-online 模式,codetabs 正在吃这个流量)、scc vs cloc、sloccount alternative、"count lines in a folder github"。

---

## 结论

站内基础是同类工具里的上游水平(canonical/SSR/Schema/llms.txt/安全头/缓存全部到位),健康分 83。当前所有排名瓶颈共享两个站外根因:**零第三方权威信号** 和 **不在 Bing 索引(ChatGPT Search 不可见)**。站内剩余高价值修正:compare 503、docs 聚类重构、llms-full.txt 更新、how-to/tokei-online 两个新页。
