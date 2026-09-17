# OctoCounts SEO / GEO 优化执行计划

- 制定日期：2026-09-08。
- 状态（2026-09-17，第三轮已合并并部署，commit 395b375、54b0063、1722612）：
  - 第三轮已部署（2026-09-16/17）：全站答案胶囊（首页/9 个 docs/101 个对比页/报告页，SSR + markdown + 客户端同源）；对比页编辑内容全量 5/101 → **101/101**（compare-editorial.js）；/research 原创研究页上线（frontend/public/research.html + research.md + research/pilot-samples.jsonl）；SG-04 前端接入完成（报告页 "Reproduce this exact report and configuration" 链接，reportSummaryJson/JSON-LD/markdown 消费 analysisKey/analysisOptions/snapshotUrl，新增 2 个测试）；docs 可见日期与 JSON-LD/manifest 统一；robots.txt 显式放行 Bytespider；api.html 重构为问题式标题 + FAQPage schema；docs 页补 BreadcrumbList + Speakable；Person 补 jobTitle/image。
  - 遗留不变：SG-08 生产验证 5 项未做；SG-09 中文页按用户决策暂缓；SG-10 测量基线未建（GSC/Bing/umami 无访问权）。
  - SG-06 试点样本（2026-09-08）：2 仓库 × 4 配置、8/8 成功、零失败，单次 1.2–1.9 秒；核心发现：排除测试使 code 行数降 26.6%（vite）至 47.7%（react），排除文档/生成文件在两样本几乎无命中。扩样 10–20 仓库（约 80 次请求、数分钟串行耗时）仍待按试点实测成本二次批准。
  - 发布后效果观察（§14）仍未开始；本地测试不能证明收录与排名。
- 范围：将本轮 10 项 SEO / GEO 建议转化为可开发、可验证、可衡量的任务。
- 执行分工：按照当前协作约定，后续具体实现交由 GPT-5.6 Terra subagent；当前主模型负责方案复核、代码审查和独立验收。内容事实核实、研究编辑与后台数据接入属于相应任务的一部分。
- 基线：基于当前本地代码、2026-09-08 线上抽查及官方文档。线上版本与本地尚未发布的 UI 改动有差异，实施时必须重新确认目标环境。
- 数据限制：尚未读取 Google Search Console、Bing Webmaster Tools、分析平台和浏览器商店后台；下列关键词是候选搜索意图，未声称存在特定搜索量，也不承诺排名或引用增长。

## 1. 目标、原则与完成定义

### 1.1 产品目标

1. 搜索或 AI 回答中的用户进入页面后，可以立即看到所承诺的答案、数据和依据。
2. 提升有效自然搜索访问与扩展安装入口的转化，分别衡量点击和实际安装。
3. 让报告及研究结论具有可核对的来源、统计口径和稳定引用地址。
4. 建立内容更新、可索引性、引用准确性和效果观察的持续流程。

### 1.2 实施原则

- 保留已经存在的 SSR、报告元信息、JSON-LD、Markdown、Sitemap、IndexNow 和分析埋点，优先补齐缺口。
- 同一页面的 SSR、客户端正文、JSON-LD、Markdown 应表达相同核心事实；允许布局与表述不同，不能数字、统计口径或支持范围冲突。
- 用户可见内容先完整，再输出机器可读表示。不得仅为爬虫输出用户无法找到的关键答案。
- 不为刷新日期而刷新日期，不以批量生成页面数量作为成功指标。
- 不改变现有首页 ref 默认 main、用户显式 ref/快照行为、Runner 后的扩展位置及已有导航修复。
- 不创建虚构评价、评分、安装量、性能对比或实验结果。
- 本轮规划无需重写整个前端框架。先完成能够独立发布和验证的小批改动。

### 1.3 完成定义

每个任务均需交付：实现或内容产物、相关自动化检查、实际页面验证证据、已知限制、回退方式。代码完成不等于增长目标达成；搜索收录、引用和转化效果必须在发布后单独观察。

## 2. 任务总表与依赖

| ID | 优先级 | 任务 | 最小可交付成果 | 主要依赖 |
|---|---|---|---|---|
| SG-01 | P0 | 修复 SSR 与客户端正文不一致 | 对比详情页加载 JS 后保留具体数据与证据 | 无 |
| SG-02 | P0 | 统一产品事实与宣传依据 | 产品事实清单、内容同步机制、冲突修正 | 无 |
| SG-03 | P1 | 建设独立扩展落地页 | /extension 完整 SSR 页面及安装入口 | SG-02；使用 SG-10 埋点约定 |
| SG-04 | P1 | 补全报告引用与统计口径 | 统一报告描述、配置展示、可复现引用 | SG-01、SG-02 |
| SG-05 | P1 | 提升重点对比页的内容质量 | 首批 5 个具有独立解释价值的对比页 | SG-01、SG-04 |
| SG-06 | P1 | 发布原创数据研究 | 1 篇研究、样本清单、数据和复现步骤 | SG-04；研究样本与资源预算 |
| SG-07 | P1 | 按真实变化维护 Sitemap 与更新通知 | 按页面维护的时间元数据和更新流程 | SG-02；与 SG-04 的数据版本约定协同 |
| SG-08 | P1 | 验证 AI 抓取与内容格式兼容性 | 抓取策略说明、格式等价及缓存测试 | SG-01、SG-02 |
| SG-09 | P2 | 建设可索引的中文页面 | 中文首页、扩展页及 1 篇核心指南 | SG-02、SG-03；中文内容维护能力 |
| SG-10 | P1 | 建立 SEO / GEO 到安装的测量流程 | 事件字典、基线报告、转化看板 | 无，阶段 A 即启动 |

依赖主线：SG-01/02 → SG-04 → SG-05/06；SG-02 → SG-03 → SG-09。SG-10 应尽早建立基线，SG-07/08 可在共享接口约定稳定后与内容建设并行。

## 3. SG-01：修复 SSR 与客户端正文不一致

### 已确认问题

线上 /compare/react-vs-vue 的初始 HTML 有具体计数、对比表和方法说明，浏览器执行 JavaScript 后却呈现通用 Compare Repos 表单。当前代码中，injectCuratedCompare 生成完整正文，而 ComparePage 只渲染通用工具；SSR 注入的数据仅有比较对象预填信息，无法直接恢复完整对比正文。

### 落地步骤

1. 区分两种页面契约：/compare 是通用工具，/compare/:slug 是有正文的具体比较页面；具体页面不得在初始化后退化成空工具。
2. 在服务端构建统一 comparison view model，至少包含 slug、页面标题、左右仓库报告、数据日期、统计说明、FAQ、相关链接和数据可用状态。
3. SSR 与客户端消费同一数据对象；首屏注入经过安全转义的 JSON 数据，客户端直接展示已存在的数据，避免先清空再重新请求。
4. 在现有 MarketingShell 中实现具体比较详情组件，保留可见的数据表、解释文本和证据链接，再提供继续交互比较的入口。
5. 不将 createRoot 机械替换为 hydrateRoot。只有服务端与客户端生成的 React 结构兼容时才采用 hydration；本轮可先共享数据与内容模块，实现可见内容一致。
6. 抽查主页及单仓库报告页的同类问题：标题、引用摘要、方法说明、关键内链和 JSON-LD 在客户端渲染后是否仍有对应正文。
7. 保留当前缺失数据与临时错误的区分：缺失报告按现有 noindex 回退语义处理，短暂上游错误保持 503 和重试语义，不能显示虚构的零值报告。

### 改动位置

- frontend/functions/[[path]].js：injectCuratedCompare、injectReport、injectHeadAndNoscript。
- frontend/src/pages/marketing.tsx：ComparePage 与具体比较详情组件。
- frontend/src/main.tsx：路由分流、初始化和元信息同步。
- frontend/tests/seo.test.mjs、frontend/qa/behavior-regression.spec.ts：已有测试扩展。
- 建议新增 frontend/shared/ 下的比较数据与纯格式化模块；具体格式应兼容当前构建和 Pages Functions 运行环境。

### 验收标准

- [ ] 禁用和启用 JS 时，具体比较页均能看到相同仓库、核心数值、数据日期和方法说明。
- [ ] 页面初次可交互后无需点击 Compare 才能看到已缓存的比较结果。
- [ ] title、H1、canonical、JSON-LD 与具体页面一致；FAQ 标记对应的问答在页面中可找到。
- [ ] 正常、单侧缺失、上游超时三类状态均有回归覆盖。
- [ ] 桌面和手机验证无明显正文消失、横向溢出或重复主标题。

### 发布与回退

先验证一个固定 slug，再应用到注册表中的比较页。若交互组件有问题，回退到保留完整服务端正文的静态可读页面，不能回退到仅有通用表单。

## 4. SG-02：统一产品事实与宣传依据

### 已确认问题

- 首页 SSR 声称支持公开 GitLab 仓库；llms-full.txt 和方法说明却限定公开产品支持 GitHub。
- FAQ 包含通常小 10–50 倍、显著更快等缺少实验条件的断言。
- 产品描述分散在 HTML、翻译文件、SSR 字符串和 llms 文件中，存在继续漂移的风险。

### 落地步骤

1. 创建产品事实清单，逐项记录事实值、适用范围、代码或官方来源、核实日期。覆盖平台、私有仓库、ref 支持、统计引擎、默认过滤、缓存、导出、API 限制、账号权限、隐私和商店地址。
2. GitLab 一项以公开入口及后端实际可用能力核实：保留在内部代码中的能力不能直接宣传成公开产品支持。不以本轮内容修订顺带扩展产品支持范围。
3. 建议新增 frontend/content/product-facts.json，存储结构化事实；中英文说明分开维护，商店 URL、版本和能力开关共用。
4. 将易冲突的 FAQ、支持矩阵和短介绍由共享事实生成或引用；不要把整个页面都变成难以编辑的模板。
5. 对性能主张建立两种处理方式：有可复现实验则标注仓库、commit、机器、工具版本、网络、缓存冷热状态与命令；无证据则改成下载源代码归档、避免拉取完整历史等机制说明。
6. 逐项同步首页、方法说明、FAQ、扩展介绍、中英文文案、JSON-LD、llms.txt 和 llms-full.txt。商店说明若不可直接编辑，生成单独的待同步文案清单。
7. 添加一致性检查：生成结果无未提交差异、支持矩阵一致、安装地址有效、数字性宣传有证据引用。

### 改动位置

- frontend/index.html、frontend/functions/[[path]].js。
- frontend/src/locales/en.json、frontend/src/locales/zh.json。
- frontend/public/docs/methodology.html、frontend/public/docs/faq.html 及其 Markdown 对应内容。
- frontend/public/llms.txt、frontend/public/llms-full.txt。
- 建议新增 frontend/content/product-facts.json 和 scripts/check-product-facts.mjs。

### 验收标准

- [ ] 每项支持能力有明确事实来源，公开页面不再出现互相矛盾的描述。
- [ ] 所有保留的性能数字都能追溯到实验；没有证据的倍数表述已移除或限定。
- [ ] 修改一个共享事实后，关联页面的生成结果可确定性更新。
- [ ] 生成器重复运行不产生额外差异；未变化的事实不自动刷新核实日期。

### 依赖与回退

无前置工程依赖。未知项明确标记待核实，不猜测。回退应保持已纠正的事实，不能因生成器回退重新引入错误宣传。

## 5. SG-03：建设独立扩展搜索落地页

### 目标与候选搜索意图

以 /extension 承接安装需求，候选词为 GitHub line counter extension、GitHub code statistics Chrome extension、show lines of code on GitHub。这些是页面定位假设，后续用曝光和访问数据修订。

### 落地步骤

1. 新增 /extension 的服务端可读页面，并配置自引用 canonical、title、description、OG 图及指向对应 Markdown 内容的可选入口。
2. 建议 title：OctoCounts GitHub Line Counter Extension for Chrome, Edge & Firefox。建议 H1：See GitHub code statistics in your browser。正文自然解释 SLOC，不在每个标题重复堆词。
3. 首屏展示具体价值、真实扩展截图和主要安装按钮。下方包含安装三步、使用示例、权限及数据处理、支持范围、常见故障、其他浏览器入口和源码链接。
4. 截图标注演示仓库与界面版本，提供有效 alt、明确尺寸和适当压缩。介绍视频可后续补充，不作为首版上线前置条件。
5. 复用现有商店地址与安装埋点；为入口添加 placement=extension_page、browser 和 page_type 等受控属性。
6. 首页 Runner 后的扩展模块继续保留，并增加了解功能的内部链接；导航和相关指南也链接到 /extension。避免修改已有安装按钮的直达商店行为。
7. SoftwareApplication 标记仅使用可验证且正文可见的信息，沿用稳定产品标识；不添加自造评分或安装人数。
8. 先发布一张完整页面。只有不同浏览器确实具有独立内容和需求时，再评估拆分页面。

### 改动位置

- frontend/functions/[[path]].js、frontend/src/main.tsx：新增页面路由及元信息。
- frontend/src/pages/marketing.tsx 或建议新增的扩展页面组件。
- frontend/src/BrowserExtensionSection.tsx、frontend/src/Topbar.tsx：内部入口。
- frontend/src/analytics.ts、frontend/public/sitemap.xml 及动态 Sitemap 条目。

### 验收标准

- [ ] 无 JS 时可读到介绍、安装步骤和商店链接。
- [ ] 三个浏览器入口均经过目标地址验证，页面不虚构浏览器支持。
- [ ] 320px、375px 和桌面布局可用，安装按钮与正文互不遮挡。
- [ ] 安装事件按实际点击触发，能区分落地页、首页和导航来源。
- [ ] 有来自首页及相关文档的可抓取内链，并进入 Sitemap。

### 效果与回退

观察该页非品牌搜索曝光、有效访问和商店点击率，不将商店点击当成安装。组件故障时可保留服务端静态介绍与安装链接。

## 6. SG-04：补全报告引用、统计口径和可复现性

> ✅ 前后端均已交付（后端 2026-09-16；前端接入随第三轮部署 2026-09-16/17）：报告页含 "Reproduce this exact report and configuration" 链接，reportSummaryJson/JSON-LD/markdown 消费 analysisKey/analysisOptions/snapshotUrl，新增 2 个测试。

### 已确认问题

报告已有计数、生成日期、ref、commit 和引擎版本，但当前 SeoReport 与 reportSummaryJson 没有完整输出分析选项。比较方法说明仅指向通用文档，不能证明每份结果实际使用了哪些排除项。

### 落地步骤

1. 从真实报告存储中读取分析配置，建立统一报告描述对象；建议包含 repository、commitSha、refName、generatedAt、tokeiVersion、analysisOptions、optionsHash、totals、languages 和 snapshotUrl。
2. 将 optionsHash 定义为规范化有效配置的稳定摘要；明确哪些默认排除规则来自引擎或服务端。它用于身份和可复现性，不是 SEO 排名信号。
3. 区分三类时间：分析产生时间、源 commit 时间和页面内容更新时间。没有某字段时显示未知或省略，不相互代填。
4. 报告加入简洁统计口径区域，说明是否包括测试、文档和生成代码、额外忽略目录及语言；详细项可展开，但关键口径默认可见。
5. 增加复制引用功能。引用至少包含仓库、代码行数、日期、commit、配置简述和可复现链接；剪贴板失败时提供可选择文本。
6. 复用现有 commit + analysis 快照链接能力，核实 SSR、客户端和 Markdown 均可恢复相同配置。不能仅因 commit 相同就把不同配置的结果视为同一快照。
7. 明确 URL 角色：仓库稳定页用于发现最新可用报告；快照用于复核某次结果。等价格式可以归并 canonical，但不同统计配置或数据快照不能无条件指向内容不同的默认结果。
8. 两个报告配置不一致或配置未知时，展示口径差异，暂停生成无条件的大小倍数结论。需要统一口径时让用户重新分析，不能静默替换数据。
9. 历史记录无法恢复配置时标注未知，并说明复现限制；不得把未知配置伪装成当前默认配置。

### 改动位置

- backend/src/seo.rs：SeoReport 与 SEO 报告输出。
- backend/src/store.rs：实施时通过图查询定位现有报告与配置读取路径，仅在确有字段缺口时扩展。
- frontend/functions/[[path]].js：reportSummaryJson、reportMarkdown、reportJsonLd、引用与比较格式化。
- frontend/src/main.tsx、frontend/src/reportUtils.ts、frontend/src/compare.tsx：口径展示、分享与比较。

### 验收标准

- [ ] 固定 commit 和配置时，网页、JSON、Markdown、复制引用中的数值一致。
- [ ] 两个不同配置的快照可正确恢复，不互相污染缓存和 canonical。
- [ ] 配置未知的历史报告不会被标记为已验证默认口径。
- [ ] 用户手动清空 ref、显式分支和已有快照 URL 的行为保持正确。
- [ ] 引用链接打开后无需人工重新填写排除项即可查看同一结果；若能力受限则明确标注，不能宣称已实现复现。

### 依赖与回退

依赖 SG-01/02。后端字段采用向后兼容扩展；旧数据缺少新字段时仍可显示报告。回退前端展示时保留已有快照链接语义。

## 7. SG-05：提升重点对比页的内容质量

> ✅ 全量扩量已完成（2026-09-16，随第三轮部署）：编辑内容覆盖 101/101 个对比页（首批 5 页 → 全量，compare-editorial.js）。本节步骤保留作为内容与验收原则记录。

### 落地步骤

1. 首批选择 5 个页面；优先按真实曝光、访问及产品相关性排序。无数据时可先选 React vs Vue、Vite vs webpack 等现有页面作为编辑试点，不能声称它们搜索量最高。
2. 每页新增独立的比较范围说明：仓库包含什么、是否单体仓库、是否覆盖示例和测试、两份数据的日期与配置是否可比。
3. 保留当前计数表和语言分布，在其后增加 2–3 条由数据支持的解释。涉及仓库架构的判断需给出该项目官方文档或源代码依据，不凭语言比例猜测。
4. 为可能被误读的页面增加针对性说明，例如框架源码大小不等于构建后应用体积，编译器仓库规模不代表语言运行性能。
5. 使用固定 commit 和相同配置生成首批可比较数据，保留双方不同分析日期，不把它们表述成同一时刻测量。
6. 从相关报告、方法说明及对比目录加入上下文内链；链接文案说明比较对象或用途，避免无关互链。
7. 扩展注册表之外的编辑元数据，保存页面特有说明、来源、核实时间和适用限制。不要把所有文章都写在一个巨大的路由字符串中。

### 改动位置

- frontend/functions/compare-registry.js：比较对象和必要的编辑元数据引用。
- frontend/functions/[[path]].js：比较摘要、方法说明和 Markdown 输出。
- SG-01 的具体比较页组件。
- 建议新增 frontend/content/comparisons/ 存放每页独立内容。

### 验收标准

- [ ] 首批每页至少有一段针对该比较对象、具有来源的独立解释，而不是仅替换项目名。
- [ ] 用户能辨别仓库规模、代码质量、运行性能和产物体积的差异。
- [ ] 正文的每个数值和倍数都可用对应报告复算。
- [ ] 页面不生成更好、更先进等无法从统计数据推出的结论。
- [ ] 编辑内容、报告值与 SG-01 的客户端页面及 Markdown 保持一致。

### 效果与回退

发布后比较这些页面与未改动页面的曝光、有效访问和后续操作变化；记录更新日期及观察窗口，不将变化直接归因于单项优化。失效的解释可单独撤回，不必删除仍有效的数据报告。

## 8. SG-06：发布一份可复现的原创数据研究

> ✅ 试点已发布为 /research（2026-09-16，随第三轮部署：frontend/public/research.html + research.md + research/pilot-samples.jsonl）。扩样 10–20 仓库仍待按试点实测成本二次批准。

### 首篇建议

建议首篇主题为“测试、文档和生成文件过滤对开源仓库行数统计的影响”。该主题直接对应现有分析选项，可以利用同一 commit 做配置对照，结果也能支持方法说明。

### 落地步骤

1. 先写研究方案，再运行分析。试点选择约 10–20 个可处理的公开仓库，列出纳入条件、排除条件、语言和项目类型分布，以及样本非随机的限制。
2. 先运行 2 个仓库验证数据、成本和耗时，再确定并发与重试上限；优先复用缓存，避免无界批量刷新。
3. 为每个仓库固定完整 commit，定义默认配置、排除测试、排除文档等实验组，记录每组实际生效配置。过滤规则不能完美识别所有文件时，在结论中披露。
4. 保存样本清单、失败记录、commit、引擎版本、配置、采集时间和原始报告地址。不能静默丢弃失败或不符合预期的样本。
5. 发布 CSV/JSON 派生统计数据、生成脚本和运行说明；确认引用或再分发内容的范围，不把源代码复制进数据包。
6. 撰写结论时区分观察值与解释：只声称所选样本在给定规则下的差异，不声称代表所有开源项目或所有语言。
7. 新增 /research/ 下的稳定文章路径，并提供有版本标识的数据下载地址。文章应包含简短答案、图表及可读表格、方法、限制、作者、发布日期和变更记录。
8. 从方法说明、重点比较页及相关报告链接到研究；生成可分享图表和 README 摘要。外部分发内容可以先形成草稿，发布或发送按后续明确任务执行。

### 建议新增产物

- research/ 下的研究方案、样本 manifest 和复现说明。
- scripts/ 下的有界采集与分析脚本。
- frontend/public/research/ 下的发布数据和静态资源，以及对应页面路由。

### 验收标准

- [ ] 至少完成一轮独立复算，表格、图表和摘要数值一致。
- [ ] 每个样本的 commit 和配置都能追溯，失败与排除有记录。
- [ ] 图表之外存在可读取的数据表和下载数据。
- [ ] 页面准确披露样本选择、过滤能力和时间范围限制。
- [ ] 新数据版本不覆盖旧引用的数据文件，旧版本仍可核对。

### 依赖与回退

依赖 SG-04。对错误研究使用显式更正说明或版本撤回，不静默修改已被引用的数字。扩展样本规模属于试点通过后的后续任务。

## 9. SG-07：按真实变化维护 Sitemap 与更新通知

### 已确认问题

indexableCompareEntries 对所有比较页使用 STATIC_SITEMAP_LASTMOD。scripts/refresh-llms-lastupdated.mjs 还会将多个 Sitemap 条目、文档 dateModified 及 llms 的日期一并改成当天，即使对应正文没有变化。该行为应改为按内容真实变化维护。

### 落地步骤

1. 建议建立按页面维护的内容 manifest，记录 canonical URL、内容版本或 hash、真实内容更新时间、页面类型和索引状态。
2. 静态页面只有正文、重要链接或相关结构化事实发生实质变化时更新日期；构建、无关文件提交、计数型埋点变化和纯日期变化不触发刷新。
3. 比较页的更新时间综合自身编辑内容和实际使用的两份报告版本。缓存重新验证时间不是内容修改时间；无法确定可靠时间时省略 lastmod。
4. 修改现有刷新脚本和工作流，保留从比较注册表生成链接清单的能力，移除全站统一写入今日日期的逻辑。
5. 保留动态 Sitemap 对明确缺失报告的过滤及临时故障容错。新增页面只能在内容可用、canonical 正确且应被索引时进入 Sitemap。
6. 定义稳定页、历史快照、参数变体和 Markdown 等价页的收录策略。优先发现稳定 HTML 页面；具有独立价值的历史版本按规则加入，不批量纳入所有表单参数组合。
7. 页面规模或诊断需求增长时，拆分 sitemap-pages.xml、sitemap-reports.xml 和 sitemap-comparisons.xml，由索引文件聚合。拆分本身不作为排名优化成果。
8. 审核现有 IndexNow 提交路径，复用已有服务；先确认是否已经有去重和重试，再补缺口。仅对实际新增、更新或删除的规范 URL 提交，不因用户访问或缓存命中重复通知。

### 改动位置

- frontend/functions/[[path]].js：sitemapResponse、indexableCompareEntries 和静态条目来源。
- frontend/public/sitemap.xml。
- scripts/refresh-llms-lastupdated.mjs、.github/workflows/refresh-llms-lastupdated.yml。
- backend/src/seo.rs、backend/src/indexnow.rs：数据更新时间和提交衔接。
- 建议新增按 URL 管理的内容 manifest。

### 验收标准

- [ ] 未改正文重复构建时，lastmod 和 dateModified 不变。
- [ ] 只修改一篇文档时，只更新该文档及内容确实受影响的聚合页。
- [ ] 比较数据版本变化能更新相应页面日期，不能把所有对比页日期一起刷新。
- [ ] Sitemap 不主动收录已知 noindex 回退、明显重复参数或重定向 URL。
- [ ] 模拟上游短暂故障时，不把有效页面永久移出发现清单。
- [ ] IndexNow 测试使用 mock，不在单元测试中对真实站点提交 URL。

### 回退

优先保留最后一份已验证的 Sitemap 和内容 manifest；无法取得可靠更新日期时省略该字段，不能回退为全站今日日期。

## 10. SG-08：验证 AI 抓取与内容格式兼容性

### 已确认问题与边界

- robots.txt 的注释把 GPTBot 训练抓取与 ChatGPT 搜索可见性混为一谈；两者需要分别描述。
- 当前代码按 UA 自动向部分抓取端返回 Markdown。抽查中某读取工具不支持该响应类型，而直接 HTTP 请求成功，因此这是需要验证的兼容性问题，不是所有 AI 都无法访问的证据。
- 当前 UA 触发的 Markdown 已设置 private, no-store 和 Vary: User-Agent；不能把这项已有隔离当成缺失功能重新实现。

### 落地步骤

1. 编写爬虫策略矩阵，分开记录搜索抓取、用户主动访问、训练使用的目的与规则。按各提供商官方文档核实 UA 身份，不能仅凭名字归为检索爬虫。
2. 修正文档与注释：允许 OAI-SearchBot 才是 OpenAI 搜索接入相关配置；GPTBot 的训练许可单独表达。修订说明不自动改变站点既有训练许可意愿。
3. 以标准 HTML 作为兼容基线，保证完整答案在不执行 JS 时可读；保留显式 .md 和 ?format=md 入口。
4. 将 UA 自动 Markdown 切换做成可回退配置；建议先在预览环境验证关闭自动切换后的 HTML 读取效果，再选择少量页面灰度。Accept 协商如需支持，应另行明确缓存键与 Vary，不能顺带仓促引入。
5. 建立固定样本矩阵：主页、报告、对比、方法文档；分别使用普通客户端、搜索抓取 UA、用户访问 UA，以及显式 Markdown URL 检查状态码、内容类型、canonical、正文关键值和缓存头。
6. 检查生产 CDN/WAF 是否对真实抓取流量返回挑战页、403 或错误缓存；模拟 UA 请求不能证明真实机器人已被放行，必要时结合提供商 IP 与服务器日志验证。
7. 在两种格式之间做语义等价检查：仓库、commit、日期、配置和数字相同，引用链接可打开，脚本或模板字符不泄漏到正文。
8. 抓取策略和 llms 声明保持一致。继续保留有用的机器可读内容，但不把新增 AI 文件视为获得引用的必要条件。

### 改动位置

- frontend/public/robots.txt、frontend/public/llms.txt、frontend/public/llms-full.txt。
- frontend/functions/[[path]].js：onRequest、AI_RETRIEVAL_BOT_UA、markdownResponse 与格式路由。
- frontend/tests/seo.test.mjs：UA、缓存与内容等价用例。
- CDN/WAF 配置属于部署环境任务，先核实真实配置，不能仅改仓库文件就宣称生产生效。

### 验收标准

- [ ] 标准 HTML、显式 Markdown 都能返回相同核心数据。
- [ ] 各格式顺序交错访问时，不会把 Markdown 缓存给普通浏览器或反向污染。
- [ ] 对各 UA 的测试结果标明模拟访问，不冒充真实搜索收录证明。
- [ ] 保留或改变训练许可的决定在策略文档中清楚可见。
- [ ] 至少完成一个实际读取端的人工检查，并记录不支持的格式和剩余限制。

## 11. SG-09：建设可索引的中文内容

### 当前基础

现有 i18next 已支持中英文 UI，并根据 querystring、localStorage 和浏览器语言选择显示。客户端语言切换不是独立、稳定的中文内容 URL。

### 落地步骤

1. 首批只建设 /zh、/zh/extension 和 /zh/docs/github-sloc-counter，对应英文 /、/extension 和 /docs/github-sloc-counter；沿用项目已有无尾斜杠规则。
2. 每个中文 URL 返回中文 SSR 正文、标题和描述，不能先输出英文正文再仅靠浏览器翻译切换。
3. 路径显式语言优先于 localStorage。语言切换使用可抓取的对应页面链接，保留用户主动选择，不根据 IP 强制跳转。
4. 各语言页面设置自引用 canonical、双向 hreflang 和适当的 x-default；没有真实对应页面时不输出虚构的 alternate URL。
5. 翻译核心内容、步骤、支持范围和常见问题，不只翻译导航。技术名词、数据和能力描述继续引用 SG-02 的事实来源。
6. 纳入对应 Sitemap，检查所有语言版本都返回正确状态码；中文页面不统一 canonical 到英文页面。
7. 尚未翻译的报告页保持当前 URL 和行为，不生成成千上万的空中文镜像。后续依据中文页面效果决定是否扩展。

### 改动位置

- frontend/src/i18n/index.ts、frontend/src/main.tsx：路径语言与路由。
- frontend/functions/[[path]].js：语言页面 SSR、元信息与 Sitemap。
- frontend/src/locales/en.json、frontend/src/locales/zh.json 及文档内容来源。
- frontend/src/main.tsx 中的 LanguageSwitcher，或提取后的共享切换组件。

### 验收标准

- [ ] 无 Cookie、无 localStorage、无 JS 时，中文 URL 仍返回中文核心内容。
- [ ] 中英文切换后的页面互相对应，canonical 和 hreflang 没有循环、404 或语言错配。
- [ ] 直接打开英文 URL 不受之前中文偏好错误覆盖。
- [ ] 三组页面的事实、安装链接和功能范围一致。

### 依赖与回退

依赖 SG-02/03。需要有维护中文正文的能力；如果阶段性不投入中文获客，可将本任务保留为后续计划。已发布语言 URL 的撤回需维护明确重定向或状态语义，避免直接留下死链。

## 12. SG-10：建立 SEO / GEO 到安装的测量流程

### 当前基础

analytics.ts 已定义 ai_visit、analyze_submitted、analyze_completed、extension_store_click 等事件。当前 AI 来源基于 document.referrer 识别；缺失 referrer 不代表没有 AI 来源。已有扩展指标脚本和工作流，应先检查实际数据来源与权限，避免重复建设。

### 落地步骤

1. 获取可用的 Search Console、Bing Webmaster Tools、当前分析平台和商店聚合数据。没有访问权限时，交付明确的导出字段模板，先完成事件规范与技术验证。
2. 发布前记录最近 28 天基线；若数据不足，记录实际覆盖期和缺失项，不以零替代未知。
3. 建立事件字典，至少约定事件名、触发时机、去重规则、page_type、source、placement 和 browser。优先补充已有事件，不随意更换名称造成历史断档。
4. 区分来源：AI referrer、可验证的来源参数、搜索 referrer、直接或未知访问。来源参数作为分析字段处理，不污染 canonical；不把普通 google.com 流量直接判为 AI Overview。
5. 检查分析脚本加载之前触发事件是否丢失。只有实际存在早期事件丢失时，补有界队列和发送后清理，避免初始化或组件重复渲染造成重复计数。
6. 建立按页面类型划分的漏斗：访问 → 有效查看或完成分析 → 商店点击。实际安装单独使用商店提供的聚合数据；无跨站关联能力时，不声称能够逐用户归因。
7. 记录 SEO 与 GEO 的不同结果：搜索曝光/点击、Bing AI 引用、AI 来源访问、分析完成和安装入口转化。没有点击的引用不会出现在浏览器 referrer 数据中。
8. 建立每周复盘模板，并记录每次发布范围及时间；优先用相同页面组和前后等长窗口比较，同时检查项目热度、发布事件和季节性影响。
9. 初期用后台导出加表格即可，不强制先开发完整管理平台。数据接入稳定后再自动化聚合。

### 建议事件约定

| 事件/指标 | 触发或来源 | 必要维度 | 不能推出的结论 |
|---|---|---|---|
| ai_visit | 可识别 AI 来源的落地访问 | source、page_type、landing_path | AI 引用总量 |
| analyze_completed | 用户的一次分析成功完成 | provider、page_type；是否缓存可选 | 所有访问都使用了分析功能 |
| extension_store_click | 用户点击商店入口 | browser、placement、page_type | 用户已经安装扩展 |
| 实际安装或活跃用户 | 商店提供的聚合数据，注明指标定义 | browser、日期、可用来源维度 | 与某次站内点击的确定关联 |
| AI 引用 | Bing AI Performance 等实际可用报告 | 页面、日期、可用检索词 | 引用对应用户访问次数 |

只采集实现目的所需的页面类型与受控属性，不增加完整表单内容、访问令牌等无关信息。统计说明与隐私页面的实际描述应保持一致。

### 改动位置

- frontend/src/analytics.ts。
- frontend/src/main.tsx、frontend/src/Topbar.tsx、frontend/src/BrowserExtensionSection.tsx 的安装入口。
- scripts/track-extension-metrics.mjs、.github/workflows/track-extension-metrics.yml：复用现有能力。
- 建议新增 docs/seo-geo-measurement.md：事件字典、导出模板和每周复盘规则。

### 验收标准

- [ ] 浏览器实测一次操作只产生一次对应事件，来源与入口维度正确。
- [ ] 分析脚本慢加载或被禁用时，页面功能不受影响。
- [ ] 看板明确区分引用、访问、商店点击和真实安装数据。
- [ ] 有一份注明日期、数据来源和缺失项的基线报告。
- [ ] 发布后的观察结果不将普通流量波动直接当成优化的因果证据。

## 13. 执行批次与交付清单

以下为按依赖排列的批次，不是未经评估的固定工期承诺。第一轮完成后，结合实际复杂度和后台数据确定后续时间预算。

| 批次 | 任务 | 实施交付 | 当前模型验证重点 |
|---|---|---|---|
| A：修复与基线 | SG-01、SG-02；启动 SG-10 | 对比正文保留、产品事实清单、基线与事件字典 | 初始 HTML 与浏览器一致；事实有依据；未改变已有 ref 行为 |
| B：引用与发现 | SG-04、SG-07、SG-08 | 口径与快照、真实更新时间、抓取格式验证 | 数值与配置一致；日期不虚刷；格式缓存不污染 |
| C：安装与重点内容 | SG-03、SG-05；完善 SG-10 | 扩展落地页、101 个比较页编辑内容全量、转化统计 | 安装链路正确；正文有独立价值；点击不冒充安装 |
| D：原创研究与语言 | SG-06；按投入意愿启动 SG-09 | 研究和数据包、首批中文页面 | 独立复算；样本限制；语言页面可索引 |
| E：效果复盘 | 覆盖所有已发布任务 | 发布记录及前后观察报告 | 按真实数据决定扩展、修订或停止实验 |

### 13.1 开发交接要求

1. Terra 每次只接收一个边界明确的任务或不冲突的任务组，并明确文件所有权；不得回退用户或其他代理的既有修改。
2. 父代理先通过 codebase-memory 查询相关符号及 coverage，再提供项目、图版本、精确文件、调用关系、未覆盖范围和验收条件。
3. 跨任务共享模块先稳定接口再并行改动。尤其避免 SG-01/03/04/07/08 同时无协调编辑 frontend/functions/[[path]].js。
4. 每批提交给当前模型的材料包括：变更摘要、相关 diff、自动化结果、浏览器验证地址与截图、错误场景、未解决问题。
5. 当前模型复核通过后，才将该任务标记为“代码验收通过”。部署和发布后的增长观察使用独立状态。

### 13.2 当前已有检查与后续新增检查

现有前端命令（工作目录为 frontend）：

    rtk proxy npm test
    rtk proxy npx playwright test

第一条命令已包含单元测试、生产构建和 SEO 测试，无需在同一份未变化代码上再重复执行构建。Playwright 按实际环境选择可用浏览器；本机临时选择系统 Chrome 应放在本地配置，不硬编码进仓库默认配置。

- 按任务增补数据契约、语义一致性、快照恢复、日期稳定和事件触发测试，不用大量镜像模板的字符串断言替代真实行为验证。
- SSR 验收必须经过 Pages Functions 测试环境、预览部署或等效请求处理环境；普通 Vite 页面不能单独证明边缘 SSR 正确。
- 每批只执行与变更相关的检查；涉及主路由、报告身份或共享渲染时再运行完整前端回归。
- 涉及 Rust API 或存储时，执行对应后端单元、契约和必要 golden 测试；不因改一个内容文件就运行无关后端任务。
- 首屏性能同时观察移动端 LCP、INP、CLS；新增截图应声明尺寸并控制加载成本。没有现场数据时只报告实验室测量，不宣称 Core Web Vitals 已在真实用户中达标。
- 搜索结果中的抓取、索引与排名不是构建测试可以证明的结果；发布后用相应后台检查。

## 14. 发布后效果观察

| 时间点 | 应做检查 | 输出 |
|---|---|---|
| 发布当日 | HTTP 状态、canonical、robots、Sitemap、正文、事件和商店链接抽查 | 发布验收记录 |
| 首周 | Search Console/Bing 抓取与索引情况、错误页、事件完整性 | 技术异常清单与修复归属 |
| 第 2–4 周 | 页面组曝光/点击、AI 来源访问、安装入口点击、商店聚合趋势 | 初步观察；样本不足则继续积累 |
| 第 4–8 周 | 结合收录进度、流量规模和发布记录比较结果 | 决定扩展重点页、继续实验或调整定位 |

观察窗口为操作建议，不是搜索引擎处理时限。先建立基线，再制定增长目标；禁止在缺乏数据时预设必须增长某个百分比。

## 15. 首轮实施前仍需确认的事实

- 公共产品对 GitLab、API 限制及浏览器支持的真实范围：SG-02 开始时以当前代码、公开入口和商店状态核实。
- Search Console、Bing、分析平台和商店后台的可用数据：不阻塞 SG-01/02 的实现，但决定 SG-10 的完整程度。
- 历史报告能否恢复完整分析配置：SG-04 核实存储，不默认已有全部字段。
- CDN/WAF 的实际缓存及机器人规则：SG-08 生产验收项；本地测试无法代替。
- 中文内容维护和研究采集预算：SG-06/09 执行前确定最小范围，先完成试点。

## 16. 证据与参考

### 16.1 本地证据入口

以下链接指向本次审查时的真实文件；行号已删除，定位以当前版本为准（行号随实施变化后应重新定位）。新增文件建议均在对应任务中明确标为建议新增。

- [具体比较页 SSR](frontend/functions/[[path]].js)（SSR 注入与比较 view model）与 [客户端 ComparePage](frontend/src/pages/marketing.tsx)。
- [首页 SSR 产品描述](frontend/functions/[[path]].js)、[产品支持矩阵](frontend/public/llms-full.txt) 与 [方法说明](frontend/public/docs/methodology.html)。
- [报告 JSON 摘要](frontend/functions/[[path]].js)（reportSummaryJson / JSON-LD / markdown 输出）与 [后端 SeoReport](backend/src/seo.rs)。
- [比较页 Sitemap 条目](frontend/functions/[[path]].js) 与 [批量更新日期脚本](scripts/refresh-llms-lastupdated.mjs)。
- [现有来源和转化事件](frontend/src/analytics.ts)、[语言选择逻辑](frontend/src/i18n/index.ts) 与 [爬虫规则](frontend/public/robots.txt)。

Codebase Memory 核对：项目 OctoCounts，根路径 /Users/lizhuo/owork/sloc，状态 ready；本轮 metadata generation 为 2026-09-08T06:46:24Z，recorded_at 为 2026-09-08T07:05:03Z。相关结构代码路径返回 metadata_match；图工具通过已安装 CLI 调用。上一轮检查发现 frontend/index.html 和 FAQ HTML 有局部解析缺口，已使用相应源码范围核对；robots/llms 等文本直接读取。图覆盖是尽力而为的信号，不构成全库完整性证明。

### 16.2 外部官方依据

- SEO 基础同样适用于 Google AI 搜索；没有必须新增的 AI 文件或特殊 Schema：[Google AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)。
- 结构化数据应对应真实、可见且相关的页面内容，适用于 SG-01/02/03：[Google structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)。
- 规模化内容应以用户价值为目标，适用于 SG-05/06 的内容门槛：[Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)。
- 不同语言应提供独立 URL，并正确关联版本，适用于 SG-09：[Google multilingual site guidance](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)。
- OpenAI 搜索、用户访问与训练抓取角色不同，适用于 SG-08：[OpenAI crawlers](https://developers.openai.com/api/docs/bots)。
- Bing AI Performance 可用于观察引用与相关检索信息，适用于 SG-10；实际可用字段以账号后台为准：[Bing AI Performance announcement](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview)。
- 性能应结合真实用户指标和实验室检查，适用于跨任务验收：[Web Vitals](https://web.dev/articles/vitals)。

官方依据核查于 2026-09-08。后续实施涉及供应商行为、抓取规则或后台指标变化时，应重新核实对应文档。
