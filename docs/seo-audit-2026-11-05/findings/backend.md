# Backend、发现渠道与度量审查（2026-11-05）

## 范围与方法

审查 backend/src/seo.rs、store.rs 的公开查询和保留策略、coordinator.rs 的 IndexNow 触发、indexnow.rs/config.rs、github.rs 的公开仓库校验；仓库 README、CLI/MCP/Action README、公开 API 文档；analytics.ts/analytics-runtime.js；frontend-checks/backend-checks、weekly seed、daily trending、extension metrics 工作流；seo-index-runbook、seo-geo-measurement、ai-crawling-policy。
采用 seo-technical 技能检查索引边界、发现链路及 IndexNow，先用 codebase-memory 图定位；图缺失的新文件再直接读源码。没有读取凭据，没有运行分析 POST 或 IndexNow 提交。

## 已落实的最小修改

1. README.md 与 cli/README.md：移除永久报告承诺。区分 live report 与 fixed saved result，并说明固定结果受缓存保留约束、可能过期或被替换，长期保存应导出 JSON/text。这与 backend/src/store.rs 的 cache upsert/cleanup 以及公开 API 文档一致。
2. README.md：缓存键说明加入 analysis options，移除未提供可复现基准的 faster/much faster、repeat runs are instant；保留确定事实：使用 archive 而不下载 Git history。
3. mcp/README.md：将 Content-Length framing 改为 newline-delimited JSON-RPC。mcp/src/index.js 的输入解析依赖换行，writeMessage 也以换行终止，每行一个 JSON 对象。

这些是纯文档修改，核对实际源码与差异后未新增或运行测试。没有修改 extension 既有用户改动。

## 现有实现值得保留

- **索引选项一致**：store.rs:102 canonical_options_sql 使用由数据库触发器维护的 options_canonical；latest_report_card、related、sitemap、所有列表均应用。include-all/custom options/旧缺失 options 的记录不会覆盖 canonical 公开统计。
- **历史数据不冒充当前**：store.rs:57 latest_eligible 排除历史 backfill，只有对应最新 live snapshot 的采样行才可当当前报告。
- **保留稳定入口**：store.rs:2988 cleanup_locked 保护每仓库最新 canonical 公开行；避免大量历史报告过期时导致整个网站报告 URL 消失。固定历史 ID 仍可能被清理，不能承诺永久存储。
- **sitemap 库存**：store.rs:2660 按仓库去重、按生成时间输出 lastmod，未设全局45000上限；seo.rs:492 限 GitHub，避免无前端路由的 GitLab 404 进入 sitemap。分片/质量门槛由边缘层负责，已交技术SEO审查。
- **IndexNow**：coordinator.rs:480 保存成功后核对它是否为当前公开 canonical 行再提交；indexnow.rs:110 还过滤非GitHub、非canonical、少于5文件；只接受配置主机的 HTTPS、无query/fragment URL。后台批量去重、有限重试，不阻断用户分析。
- **内容可引用**：seo.rs:709 的 citation 有生成日、commit、files/code/comments/blanks、tokei 与配置摘要；snapshot URL 可绑定报告ID。数字是观测，不是实时状态/开发者生产力。
- **私有仓库新分析拒绝**：GitHub GraphQL 的 is_private 与 REST private 均显式拒绝（github.rs:273、1189）；不是靠robots约束隐私。
- **源数据边界清楚**：/api/stats 文档声明 operational aggregate，不是用户级流量；API文档说明限流、排队、可重试POST前提、缓存保留、默认选项差异。
- **分析度量**：analytics-runtime.js 区分已知AI referrer与可编辑的ChatGPT UTM，限定hostname，session去重；没有把google.com访问冒充AI Overview，也没有把store点击当安装；measurement文档明确引用无点击不可观测。
- **持续检查存在**：frontend-checks运行 npm test、scripts所有测试、Playwright；backend-checks配置真正的Postgres以避免DB测试空跑；seed每周轮转、trending每日、extension metrics每日。

## 线上抽查（3个API URL）

使用curl默认TLS证书校验、2026-11-05 06:55 UTC（14:55 Singapore）：

| URL | 状态 | 观测 |
| --- | --- | --- |
| https://api.octocounts.com/robots.txt | 404 | 无API专用robots |
| https://api.octocounts.com/api/stats | 200 application/json | 无X-Robots-Tag，无Link canonical；max-age=60 / s-maxage=600 |
| https://api.octocounts.com/api/seo/report?provider=github&owner=facebook&repo=react | 200 application/json | 无X-Robots-Tag，无Link canonical；max-age=60 / s-maxage=604800 |

三个响应均报告 x-octocounts-build: v0.7.43。最初Python请求被本机缺失CA阻断，未把该异常当作网站TLS问题；改用curl默认校验成功。

## 尚待处理的机会与验证方法

### 中：API原始JSON与HTML的索引边界未显式设置

backend/src/main.rs 的路由/中间件及线上两个JSON响应均未见 noindex。公开文档有指向这些接口的链接，爬虫可能发现原始JSON版本；是否实际被搜索引擎收录未取得证据，因此不是已证实重复收录或Critical。

最小方案：对 /api/* 读取响应加 `X-Robots-Tag: noindex`，仍允许正常抓取/机器读取；不要使用 robots Disallow 代替 noindex。不要意外给根站 canonical HTML 加noindex。依赖：先确定产品是否希望任何API JSON可被普通搜索索引。验收：API 200仍可用且有noindex，HTML报告保持indexable；从GSC/Bing验证原始API URL逐步不作为搜索落地页。

### 中：度量体系有代码，缺少真实基线

seo-geo-measurement.md 的GSC/Bing/Umami基线仍为unknown，不能证明历史多轮SEO改动提高曝光、点击或AI引用。既有 docs/chatgpt-geo-baseline.csv 是更合适的复用入口。

建议导出连续28天（固定页面组和查询集）的impressions/clicks/CTR/position、AI visits、analyze_completed、store clicks；对固定AI问题多次独立运行并记录分母。验收：报告有真实导出日期、来源、窗口、样本量；不能用site:搜索条数替代索引库存，不能用UA模拟代替真实爬虫到达证据。

### 中：历史公开仓库转私有/删除后的报告处置需有明确流程

观察：SEO读取路径只访问已保存数据库，没有逐次向GitHub重验证公开状态；cleanup保护最新canonical行。新私有仓库会被拒绝，但不能据此推导旧公开报告在仓库转私有后立即下架。这是保留政策边界，不是发现有私有代码泄露。

建议首先形成可执行的takedown/删除流程和缓存失效范围（DB、应用缓存、CDN、sitemap）；如公开状态刷新检查确证404/private，再同步去除公开入口。不要仅凭一次GitHub超时/限流删除数据。验收：模拟public→private后列表/sitemap/报告/旧ID的行为符合明示政策；对GitHub上游503不误删。此次未实现未经确定的自动删除策略。

### 低：IndexNow运行状态不等于已收录

服务具备实现，但没有读取生产密钥或后台日志，不能声称生产启用/提交成功；静态文档更新不经过report complete hook，仍依靠runbook `--core` 显式补交。批次最终失败会记录日志并丢弃，是当前小规模实现的已知可接受限制。

建议沿用现有脚本在部署后验证key文件并提交当前sitemap核心页；监控成功/失败批次数，不把202 accepted写为indexed。若日志显示持续丢批再考虑持久重试队列，不预先引入基础设施。

### 低：仓库运维文档量化信息老化

seo-index-runbook.md 硬编码24静态、101对比、8 docs，与现存扩展内容规模不应长期绑定；旧文档的site:结果数与核心>80%收录目标缺乏当前基线。主agent负责改为动态库存和验证方法，避免历史计划成为AI提取的当前事实。

## 未检查 / 风险

没有GSC/Bing/Umami私有导出、生产WAF配置、真实crawler日志、IndexNow后台日志、npm已发布包内容；没有运行后端DB测试或生产写操作。源码审查不是全量安全审计，API头缺失不证明API已收录，SEO/GEO改动无法承诺排名或AI引用提升。
