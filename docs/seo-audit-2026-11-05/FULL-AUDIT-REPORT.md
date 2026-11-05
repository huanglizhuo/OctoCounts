# OctoCounts SEO / GEO 全面审查与优化

审查日期：2026-11-05（Asia/Singapore）。对象：当前工作区及 https://octocounts.com。类型：免费开发者工具、公开仓库数据产品。本文区分已实现修改、线上观测和后续假设；本轮未部署、未提交搜索索引、未修改 Cloudflare。

## 结论

当前项目的基础技术 SEO 已比较完善：可读的服务端正文、规范 URL、按类型拆分的 sitemap、中英文页面、结构化数据、Markdown 副本、计数规则和可追溯研究都存在。继续增加相近关键词页面、重复 schema 或“AI 专用文件”，预期价值小于修复真实事实错误、保证渲染一致和建立实际效果基线。

本轮落实了对比报告身份校验、故障恢复、报告内链轮换、渲染后研究入口、指南示例及工具比较事实、语义 HTML、项目说明和收录测量规范。没有修改仓库计数规则或历史研究数据，没有增加依赖。用户原有 extension 改动保留。

**不提供综合 SEO/GEO 分数**：未取得真实搜索曝光、收录、CrUX、外链和 AI 回答采样数据，给这些维度打分会制造精度。本次可确认的是检查覆盖、具体缺陷、修复和验证结果。

## 覆盖范围和证据边界

| 维度 | 本次覆盖 | 结果 / 限制 |
|---|---|---|
| 公开静态页面 | sitemap 中全部 35 个 URL，包括 17 篇英文指南、2 篇中文指南、中英文首页、工具/集合页、研究和信任页面 | 全部取到 200；均有唯一 H1、自引用 canonical 和 description；样本内没有重复 title 或 meta noindex |
| 程序化页面 | 全部生成模板及资格逻辑；线上 3 个精选对比、4 个报告样本 | 样本全部 200、canonical 正确；未逐个访问全部报告和对比页 |
| Sitemap | static、compare、reports-1 全量 URL 库存 | 35 静态、101 对比、7,649 报告；数量是当次观测，会变化，不代表收录数量 |
| JSON-LD | 42 个页面的 115 个脚本；共享 schema 和 HTML/Markdown/客户端生成逻辑 | 语法均可解析；这不等于所有 Google 富结果类型通过在线资格验证 |
| 站内链接 | 42 页共 1,530 个链接元素，URL 与 sitemap 库存交叉核对 | 35 个静态页均在本次抓取页面中有入链；未为全部链接逐一发 HTTP 请求，不宣称全站零死链 |
| 静态内容源 | 25 个 public HTML 文件（含 404）、Markdown twins、llms 文件、README/CLI/MCP/Action 说明 | 纠正内容漂移；逐页内容评估见 [内容报告](findings/content.md) |
| 渲染与移动端 | 首页、中文首页、API 指南、报告、对比、Recent，在 1440px 和 390px 查看 | 最终样本没有页面横向溢出；研究/术语链接在报告客户端丢失，已修复并加浏览器断言 |
| 后端与发现 | 公开报告资格、canonical options、历史排除、保留、IndexNow、相关数据接口、定时工作流、分析事件 | 现有主要资格逻辑完善；3 个 API URL 只读抽查；详见 [后台报告](findings/backend.md) |
| 搜索与品牌 | 公开品牌查询、站内限定搜索、官方 GitHub/扩展商店结果和社区发布样例 | 证明存在公开发现入口；不能由此计算搜索排名、外链质量、AI 引用率或完整收录量 |
| 性能 | 生产构建、现有 gzip 预算、移动截图、浏览器回归 | 未取得当前 CrUX / RUM，未运行本轮 Lighthouse；不复用历史性能分数冒充本次测量 |

线上抓取遵守现有 robots，最大并发 4，页请求后间隔 1 秒；未向分析 API 提交任务。原始 HTML、crawl.json、截图和渲染记录保存在 `/tmp/octocounts-seo-2026-11-05/`，不纳入产品源代码。

第一次 Python 请求因本机 CA 缺失失败，改用保持 TLS 校验的 curl 成功；不是网站 TLS 故障。报告桌面首轮等待 networkidle 超时，后以 DOMContentLoaded + 正文出现复核成功，不将网络空闲超时当成不可索引。Recent 两次独立抓取的列表变化经同一响应前后对照确认是数据更新，不是 hydration 丢链。

## 已修复的问题

| 优先级 | 问题及影响 | 本轮实现 | 验证 |
|---|---|---|---|
| 高 | 对比页知道旧仓库 A 重命名为 B，却可能接受 C 的报告，生成错误 HTML/Markdown/Dataset | 复用 reportMatchesRoute，在恢复目标后再核对报告身份 | 错配 HTML/Markdown 不再发布；合法重命名仍成功 |
| 高 | 每天 64 条轮换报告链接只推进 1 条，新增曝光窗口极慢 | 每天推进完整 64 条批次，页面链接数不增加 | 130 项库存连续 3 天覆盖、同日稳定、跨尾和相邻批次验证 |
| 中 | 重命名查询 503、坏 JSON、非法 slug 被当作“无映射”缓存十分钟 | 只有真实 404 缓存无映射，其余失败允许下次重试 | 三类故障后即时恢复测试 |
| 中 | 报告 SSR 含研究、术语入口，客户端替换 DOM 后丢失 | ReportAbout 补对应可见链接，报告内容日期更新 | 真实线上 DOM 复现；本地浏览器断言通过 |
| 高 | GitHub API 指南 Python 示例无限轮询，failed 后仍取 reportId，无网络超时 | 有限轮询期限、请求超时、显式失败、输出 jobId 方便恢复；解释反复 polling | 成功、失败、超时 mock 自检；HTML 与 Markdown 代码一致 |
| 中 | git/wc 示例破坏含空格或换行的文件名，还把 newline 当 SLOC | NUL 分隔、参数终止符，并说明未终止行、二进制及批次总数限制 | 临时仓库特殊文件名实际执行 |
| 中 | FAQ、指标和比较文案存在不支持的功能/速度/计数含义断言 | 修正 job 查询、输出格式、复杂度、code share；对照上游修正 cloc/scc/tokei/SLOCCount 比较 | 产品事实检查、跨格式检查；来源和逐页修复见内容报告 |
| 中 | API、Contact、Privacy 正文缺 main landmark | 增加原生 main 容器，不改页面正文或假刷新日期 | 静态结构检查 |
| 中 | README 宣称永久保存、即时速度，MCP 文档仍描述旧 framing | 区分 live report 与缓存结果、补全 options 缓存键，说明 newline-delimited JSON-RPC | 对照 backend/store、CLI、MCP 实现 |
| 中 | 收录手册用过期页数、site: 结果数和无基线比例判断成效 | 改为动态 sitemap 库存、真实 GSC 状态和等长周期；更新 Google AI 曝光报告说明 | 官方文档核对，未伪填业务数据 |

轮换改善的量化只适用于固定库存：`ceil(7649 / 64) = 120` 天可在该窗口内首次展示全部报告链接；旧逻辑需约 7,586 天。实际库存变化、缓存、爬虫频率和页面价值都会影响真实发现，**该数字不是抓取或收录承诺**。

实际修改的指南同步 HTML 可见日期、Markdown、TechArticle、content-manifest 和 sitemap mirror；没有把所有页面统一刷新为今天，也没有把旧研究重标为最新引擎测量。

## Skill 检索、选择与使用

通过公开搜索找到常见开源方案，再核对作者仓库；下表不是按安装量或效果做的排行榜。

| 技能库 | 适用场景 | 本次使用 / 取舍 |
|---|---|---|
| [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) | 技术 SEO、schema、sitemap、内容、渲染、性能检查 | 使用已安装 seo / seo-audit / seo-technical / seo-schema，按完整审查工作流分工并验证 |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | ai-seo、内容、搜索意图、转化与测量 | 使用已安装 ai-seo，重点看可提取答案、事实、引用及来源归因 |
| [zubair-trabzada/geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude) | AI 访问、引用准备、实体、跨平台检查 | 使用已安装 geo / geo-content，限制抓取量、分开机器可读与真实引用效果 |
| [aaron-he-zhu/seo-geo-claude-skills](https://github.com/aaron-he-zhu/seo-geo-claude-skills) | 内容质量、意图、站点结构和监测 | 检索确认旧仓库已指向 [aaron-marketing-skills](https://github.com/aaron-he-zhu/aaron-marketing-skills)；现有技能足够，无需重复安装旧版 |

关键校正：本地 ai-seo 技能仍写“没有 AI-specific Search Console reporting”。本轮访问 [Google 当前官方帮助](https://support.google.com/webmasters/answer/16984139)，确认已有 Generative AI performance 报告，提供 AI Overviews / AI Mode 曝光并可能因曝光不足不显示。项目测量文档已补充：缺失不等于零、AI 曝光不等于点击/转化、它包含在 Web 数据中不能相加、注意 PT 日期和导出缺失值。没有改写全局已安装技能。

同样没有采信技能中的固定“引用提升百分比”、机械最低字数和未经验证的排名信号。Google 明确说明 AI 搜索仍依赖基本 SEO，不要求额外 AI 文本文件或专门 schema；本次保留已有 llms 文件作便捷入口，不把添加文件当成增长成果。[官方依据](https://developers.google.com/search/docs/appearance/ai-features)

## 仍值得提升的事项

| 优先级 | 证据和建议 | 依赖 / 如何判断有效或失败 |
|---|---|---|
| 高 | 缺 GSC、Bing、Umami 实际基线，历次修改效果无法归因。复用现有 measurement 和 prompt CSV，先补真实数据 | 获取属性授权或导出；按相同页组比较连续 28 天。没有数据就保留 unknown；若报告数量增加但曝光/使用无改善，应先检查需求与质量 |
| 高 | 旧 worked examples、repo size 与部分规模表格只有短 SHA / 移动的 live 链接，证据不如研究完整 | 逐项绑定已存在的 versioned JSON / full SHA / engine / policy；新采集另存版本。验收是每个精确历史数字能回溯，不是把日期改新 |
| 中 | 17 个指南中有意图相近的组合：tokei-online/vs-tokei、count-lines/count-without-cloning、best-tools/三工具比较 | 用 query×page 数据判断是否真正争夺同意图。若页面各自解决不同任务就保留；只有证实重复价值才合并并301，不凭相似标题删除 |
| 中 | 7,649 报告的质量门槛主要是文件数，不能保证搜索需求；第二页起 noindex 的集合也不能单靠 follow 保证发现 | 先观察轮换修复后真实 crawler 唯一URL及GSC状态。若仍没有访问/需求，再评估有内容价值的稳定主题目录；不批量增加薄页 |
| 中 | api.octocounts.com 的两个 JSON 响应没有 X-Robots-Tag 或 canonical Link，原始数据与网页的索引策略尚未明示 | 未证明 API 已被收录；先确定哪些原始数据需要搜索落地，再考虑对 API 读取响应加 noindex，保留抓取。禁止误覆盖主域 HTML |
| 中 | 新私有仓库分析会被拒绝，但历史公开仓库变私有/删除后，已保存统计不立即重新验证可见性 | 明确下架/缓存清理流程与保留政策；不得因一次 GitHub 超时直接删除数据。此次未发现私有源代码泄露，也未执行自动删除 |
| 中 | Dataset 缺少明确数据许可的历史建议仍需要产品决策 | 源码 MIT 不能直接推导整个数据集许可；决定许可范围后再加入对应字段/页面，不擅自授权。见 [Dataset 文档](https://developers.google.com/search/docs/appearance/structured-data/dataset) |
| 中 | 真实 WAF 机器人可达性、IndexNow 接收、Google AI 功能账户设置未验证 | 部署后核验真实 crawler/IP 日志和搜索后台，不把模拟 User-Agent 200 当成所有真实机器人都可达 |
| 中 | 当前尚无本轮真实 CWV 数据；集合 HTML 约 132–138 KiB 未压缩 | 先看 CrUX/RUM 的 LCP/INP/CLS 与冷启动 trace；不能由 HTML 字节数或预算通过推断性能合格，未见实测前不盲拆组件 |
| 中 | 研究是目前最有差异性的可引用内容，但本站内容不能代替站外认可 | 以真实复现、维护者反馈和有上下文的引用传播研究。记录独立引用及日期/样本限定，不制造论坛提及或购买伪引用 |
| 低 | 中文只有首页与两篇核心指南 | 先观察中文查询和使用需求，再翻译最有价值的页面；保留 reciprocal hreflang 与事实版本一致，不建空壳中文页 |

## 验证结果

- `npm test`：CSP、66 项单元测试、57 文件产品事实检查、生产 TypeScript/Vite/首页预渲染/Explore SSR 构建、140 项 SEO 测试、资源预算通过。
- `npm run test:qa -- --workers=2`：89/89 通过。补充报告内链后，单独再运行 render-parity 三项，3/3 通过。
- 指南 Python 和 git/wc 示例执行标准库 mock / 临时本地仓库自检，无线上分析提交。
- gzip JS 预算：英文首页 155.9/165 KiB，中文首页 168.4/180，报告 185.5/200，工具页 165.8/175；CSS 16.1/18 KiB。它们是构建预算，不是 CWV 分数。
- `git diff --check` 通过。生产部署、后台数据库集成测试、付费 SEO 数据库与跨 AI 平台多次回答采样未执行。

具体上线顺序、验收与观察窗口见 [行动计划](ACTION-PLAN.md)。本地修复不代表已上线、已收录或排名提升。

## 一手资料与进一步审查

- [Google AI 功能与网站](https://developers.google.com/search/docs/appearance/ai-features)：访问、可索引正文、链接及内容一致性。
- [Google 生成式 AI 优化指导](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)：以人和真实价值为核心，审慎对待第三方排名建议。
- [GSC 生成式 AI 效果报告](https://support.google.com/webmasters/answer/16984139)：本次新核对的曝光统计与限制。
- [结构化数据政策](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)：标记应与可见内容一致，不虚构事实。
- [Sitemap lastmod](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)：反映实际重要内容更新。
- [site: 查询边界](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site)：搜索结果不是完整索引清单。
- [技术审查详情](findings/technical.md)、[内容逐页审查](findings/content.md)、[后端与度量审查](findings/backend.md)。

下一次复查优先核对：上线后正确内容是否进入搜索引擎渲染结果、轮换目录是否扩大真实爬虫访问、历史数字证据是否补齐，以及同口径曝光/分析完成/AI 引用是否变化。缺少这些证据时，不把后续波动直接归因于本次代码。
