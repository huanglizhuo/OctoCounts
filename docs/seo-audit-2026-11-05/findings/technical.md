# OctoCounts 技术 SEO / Schema 审查

审查日期：2026-11-05。范围为本地代码；线上取样和最终构建结果由主审查汇总。采用 `seo-technical`、`seo-schema` 技能，使用知识图谱 search/trace 定位调用关系，并补读图谱缺失或过期的文件。本报告不将技能评分当作搜索引擎评分。

## 已修复

### P1：仓库重命名恢复绕过报告身份校验

- 位置：`frontend/functions/[[path]].js` 的 `resolveRenamedCompareEntry`。
- 触发：对比页旧仓库名称 A 请求到仓库 C 的报告，独立 redirect 接口确认 A → B；原代码只检查存在重命名，未确认 C 是否为 B，随后发布 200 HTML/Markdown/JSON-LD。
- 影响：把第三个仓库的数字、引用和分析结论放进固定对比 URL；损害内容可信度，可能被搜索或 AI 引用为错误事实。
- 修复：恢复目标后复用现有 `reportMatchesRoute` 再次校验。匹配失败沿用现有 503/no-store 或之前正确的 stale 响应。
- 验证：新增 HTML 和 Markdown 回归；既有合法重命名恢复测试仍须通过。
- 后续指标：线上 compare 页 5xx/身份不匹配日志；错误报告不可出现在页面、Markdown 或 Dataset。

### P1：每日轮换内链实际只新增一条

- 位置：同文件 `rotatingReportLocs`，调用范围 `recent`、`popular`、`hall-of-monoliths`、`trending` 的共享报告目录。
- 证据：每天起点是 `dayNumber % N`，虽然显示 64 条，下一天只推进 1 条。固定 4,500 条库存需约 4,437 天才能在这一个轮换窗口中全部出现。
- 修复：起点改为 `(dayNumber * 64) % N`，每次推进一整个现有批次，没有增加页面链接数或新页面。
- 固定库存的首次覆盖上界：`ceil(N / 64)` 天；4,500 条示例约 71 天。完整重复周期为 `N / gcd(N, 64)` 天。库存变动、缓存跨日和爬虫访问时间会改变实际观察，**不保证 Google 抓取或索引**。
- 验证：130 个合法 URL，连续三天联合覆盖全部；单日稳定、相邻两天无重复、跨末尾取回开头。使用真实路由生成 Markdown 进行检查；既有 HTML 与客户端种子一致性测试覆盖其他呈现层。
- 后续指标：服务器爬虫访问中被访问的唯一报告 URL 数、Search Console 已发现/已抓取报告数；若只增加链接而访问没有增加，需核查抓取需求和页面价值。

### P2：临时 redirect 接口失败被缓存成“无重命名”

- 位置：同文件 `redirectConfirmedSlug`。
- 原行为：503、其他非 200 响应以及坏 JSON 均缓存 null 十分钟；后端恢复后，对比页仍持续失败。
- 修复：只有真实 404 才缓存“无映射”；其他失败和非法 owner/repo 不写缓存，下次请求重试。合法重命名仍按原 TTL 缓存。
- 兼容性：已核对 `backend/src/seo.rs::redirect`，200 返回 `redirectSlug` 字符串，缺失映射返回 404；没有合法 200/null 分支。
- 验证：503、非 JSON、非法 slug 三种情况均先返回 503，下次成功响应恢复 200，无需等待 TTL。

### 内容更新时间同步

同步内容审查实际改动的十一篇文档 sitemap 日期为 2026-11-05：`glossary`、`faq`、`github-language-bar-alternative`、`tokei-online`、`count-lines-of-code-github`、`github-api-count-lines`、`best-sloc-counter-tools`、`octocounts-vs-cloc`、`octocounts-vs-tokei`、`octocounts-vs-scc`、`tokei-vs-cloc-vs-scc`。主代理补齐报告客户端丢失的 glossary/research 链接后，对应更新 `REPORT_CONTENT_LASTMOD` 为 2026-11-05 及两个既有 sitemap 测试的模板日期。未刷新未改动文档或动态集合日期。

## 审查覆盖与现有良好实现

| 范围 | 观察 / 结论 |
|---|---|
| robots 与 AI 访问 | 静态 robots 明确区分检索机器人和训练机器人，声明 sitemap；仍需线上核查 Cloudflare managed robots/WAF，静态文件不能证明真实机器人可达。未改用户现有训练许可策略。 |
| canonical / redirects | 静态 .html、尾斜线、重复斜线、首页别名、中英首页参数、旧 q/url 查询、仓库名称大小写和 rename 均有规范化逻辑及大量回归。未添加无依据的新全站重定向。 |
| 404 / 503 / cache | 报告不存在、薄报告、过界集合分页和空 sitemap chunk 返回实际 404；上游不可用返回 503/no-store/Retry-After；快照 private/no-store；ETag 覆盖完整表示。 |
| 报告/引用身份 | 非默认 ref 在 canonical、Markdown、Dataset 下载中保留；commit URL 校验 commit 前缀；保存结果不会无声替换成最新数据；自定义 analysis 无 reportId 不发布错误公共计数。 |
| Sitemap | 静态、compare、report 分离；报告每片 10,000；与后端共享最小文件数门槛；compare 以实际报告资格筛选；文本 twins 不纳入 sitemap；动态集合不伪造 lastmod。 |
| 渲染 | 首页构建预渲染；Explore 使用同一 React 树 SSR/hydration；报告表、比较、文档、统计、Trending 有可读原始 HTML；错误页保持真实状态；无按 UA 喂不同内容的规则。 |
| HTML/Markdown parity | 文档提供静态 twin；报告、compare、stats、trending、extension 从同一事实源产生；HTML 面向所有 UA，Markdown 必须显式请求，带 noindex 防止重复索引。 |
| Schema | 报告共享 `report-schema.js` 供边缘与客户端使用；Dataset、SoftwareSourceCode、BreadcrumbList；集合为 CollectionPage/ItemList；应用页为 WebApplication；日期使用事实时间，JSON-LD `<` 转义。 |
| Schema 真实性 | 不应为免费开发者工具编造 AggregateRating、Organization 规模、用户数量或研究结论；现有 FAQPage 不以 Google 富结果/AI 引用收益为理由扩写或删除。Dataset 是数据语义及 Dataset Search，用它不代表普通 Google 搜索富结果保证。 |
| hreflang | 已有首页及两组中文指南专门路由和回归；不应给无完整中文内容的页面虚构 alternate。静态文档全部由内容/主审查另行核验。 |
| 安全/链接 | JSON/HTML/XML 采用专门转义；固定资源缓存不盲目 immutable；嵌入页局部允许 frame，且 noindex；常规页面保持 CSP/安全头。 |
| IndexNow | 环境键验证文件路由存在，状态需结合后端发送配置与生产响应验证；未替用户提交外部搜索服务。 |
| 性能 | lazy compare editorial、模板缓存、并行主报告/related fetch、optional related 1秒限时已存在；主审查应以真实构建/实测判断，不凭代码给 LCP/INP/CLS 分数。 |

## 未直接更改的机会

1. **P2，分页发现策略**：collection 第 2 页起为 `noindex,follow`，其 self canonical 明确。对较大报告库存，长期 noindex 页是否仍有效传递发现信号需要结合爬虫日志和 GSC，而非仅依赖 follow。轮换修复已改善首页集合的链接覆盖；若报告仍大量未发现，可评估稳定可索引主题目录或有实质内容的语言聚合页，避免增加薄分页。
2. **P2，去重与质量**：文件数门槛仅是粗筛，不能证明每个报告有搜索需求。按独特仓库、真实 commit/规则、覆盖语言、实际访问与搜索需求评估是否应扩张比较目录；不应因已能批量生成而直接多建数千页。
3. **P2，生产端监控**：本地测试无法证明 Cloudflare WAF 对 Googlebot/OAI-SearchBot 无拦截、Search Console 已索引、IndexNow 被接收或主流 AI 已引用。需要以部署后的匿名 HTTP、验证机器人访问日志、GSC/Bing 和重复采样补齐。
4. **P3，sitemap 入参容错**：现有正则允许部分 percent-encoded 或 `~` 的路径，但报告路由对 owner/repo 更严格。后端目前输出标准 GitHub 名称，没有观察到生产坏条目；未为假设污染重写解析器。若生产 sitemap出现编码别名/非法日期，再统一从后端规范化源头修复。
5. **P3，重复 JSON-LD 与高分诱导**：页面已有合理语义结构，继续堆 schema 没有已证实价值。优先保证数据可复现、引用一致和能抓到内容。

## 验证边界

初次定向测试因缺少 `frontend/.generated/explore-ssr.js` 无法启动，不是断言失败；主代理统一 build 后确认 66 项 unit、140 项 SEO、CSP、产品事实与资源预算检查全部通过；本分工之后另跑通过 4 项重命名/轮换测试以及更新报告模板日期后的 2 项 sitemap 测试；浏览器 QA 由主报告汇总。主代理线上 sitemap 统计为 7,649 个报告，在固定库存假设下轮换首次覆盖上界为 `ceil(7649/64) = 120` 天；已去掉代码注释中过时的约 4,500 总数和约 4,400 孤立页猜测。本分工未部署、未修改 Cloudflare 配置、未调用私有 GSC/Bing 或获取 CrUX 现场指标。

跳过：不扩张页面、不增加依赖、不凭技能声称 AI 排名提升，不修改用户已有 extension 工作。风险：本地修复须部署后再验证真实抓取与索引结果。
