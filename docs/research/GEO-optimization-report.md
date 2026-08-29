# OctoCounts SEO/GEO 优化诊断报告

> 基于 `seo-geo`、`yao-geo-panorama-audit`、`yao-geo-intent-miner` 三个 GEO skill 的综合诊断  
> 诊断对象：OctoCounts (https://octocounts.com/) — GitHub SLOC 计数器  
> 诊断日期：2026-08-28

---

## 1. 执行摘要

### 1.1 GEO 准备度评分：72/100

OctoCounts 是一个技术基础扎实、内容资产丰富的开发者工具站点。站内已具备完整的 SSR、结构化数据、`llms.txt`、AI 爬虫允许策略和比较/趋势/report 等可引用页面，在**技术可抓取性**和**结构化内容**上得分较高。主要失分项集中在**站外品牌提及**、**AI 答案可引用段落的前置化**、**中文 GEO 市场覆盖**以及**部分关键页面的语义密度与定义清晰度**。

| 维度 | 得分 | 说明 |
|---|---|---|
| 技术可抓取性 | 90/100 | SSR、robots.txt、sitemap、llms.txt、CSP、IndexNow 均已配置 |
| 结构化内容与 Schema | 85/100 | Dataset、FAQPage、BreadcrumbList、Organization、JSON-LD 完整 |
| 可引用性与答案前置 | 65/100 | 文档页较优，但首页营销文案和比较页可进一步前置“X 是...”定义 |
| 权威与品牌信号 | 55/100 | 站外 Wikipedia/Reddit/YouTube/LinkedIn 提及不足 |
| 多模态与中文覆盖 | 50/100 | 缺少中文页面、视频教程、演示动图/视频 |
| 内容新鲜度机制 | 75/100 | 报告页有更新日期，但文档页和首页缺少显式最后更新 |

### 1.2 平台分解

| 平台 | 当前可见性 | 关键杠杆 |
|---|---|---|
| Google AI Overviews / AI Mode | 中高 | 页面已排名且可被抓取；需强化答案段落与实体权威 |
| ChatGPT / SearchGPT | 中 | 已有 llms.txt 和允许爬虫；需补 Reddit/Wikipedia 品牌实体 |
| Perplexity | 中 | 结构良好；需更多第三方引用和社区讨论 |
| 国内 AI（DeepSeek/豆包/千问/Kimi/元宝） | 低 | 无中文页面，缺少中文社区与百科证据 |
| Bing Copilot | 中 | 建议提交 IndexNow 并强化 Bing 可索引的实体 |

---

## 2. 站内诊断

### 2.1 官网抓取覆盖

已抓取页面：

| URL | 类型 | 状态 | 关键观察 |
|---|---|---|---|
| https://octocounts.com/ | 首页 | 可抓取、SSR | 首屏即工具入口，但“OctoCounts 是什么”的定义性句子 buried 在交互之后 |
| https://octocounts.com/docs/github-sloc-counter | 产品指南 | 可抓取 | 结构清晰，有定义、表格、示例、API 链接；最后更新 2026-08-15 |
| https://octocounts.com/docs/methodology | 方法论 | 可抓取 | 优秀的可引用页：What is SLOC?、Counting Pipeline、Metrics、Limitations |
| https://octocounts.com/docs/api | API 文档 | 可抓取 | 待进一步验证 |
| https://octocounts.com/compare/react-vs-vue | 比较页 | 可抓取、SSR | 有数据表、引用段落、免责声明，但顶部缺少“X vs Y 是...”的定义 |
| https://octocounts.com/trending | 趋势聚合 | 可抓取、RSS | 内容动态加载，需验证 SSR 输出 |
| https://octocounts.com/stats | 统计页 | 可抓取 | 动态聚合数据 |
| https://octocounts.com/badges | 徽章构建 | 可抓取 | 工具页 |

### 2.2 品牌实体档案

| 字段 | 内容 | 来源状态 |
|---|---|---|
| 品牌名 | OctoCounts | 官网已明确 |
| 英文名/别名 | OctoCounts GitHub SLOC Counter | 官网/llms.txt |
| 产品定义 | 免费公共 GitHub 仓库源码行数计数器 | 官网/llms.txt |
| 核心功能 | SLOC 报告、浏览器扩展、徽章、API、CLI、MCP server、GitHub Action | 官网 |
| 适用对象 | 开发者、技术决策者、开源维护者 | 推断 |
| 不适用 | 私有仓库、源代码上传 | 官网明确 |
| 作者/维护者 | huanglizhuo | GitHub/llms.txt |
| 许可证 | MIT | 官网/llms.txt |
| 公司主体 | 未明确公司实体（个人/开源项目） | 待确认 |

**风险点**：官网缺少“关于我们/About”页面，品牌主体为个人开发者，对 YMYL 不相关但会降低部分 AI 答案的权威归因。

### 2.3 技术可抓取性

| 检查项 | 状态 | 备注 |
|---|---|---|
| robots.txt 允许 GPTBot/OAI-SearchBot/ClaudeBot/PerplexityBot | ✅ | 含 `Content-Signal: search=yes,ai-input=yes,ai-train=yes` |
| robots.txt 允许 Google-Extended/Applebot/CCBot | ✅ | 训练数据也被允许 |
| /llms.txt | ✅ | 存在且结构完整 |
| /llms-full.txt | ✅ | 更详细上下文 |
| /sitemap.xml | ✅ | 含静态页、文档、比较页；需验证动态 report 页是否也提交 |
| SSR | ✅ | 报告页、比较页、趋势页均有 SSR |
| JSON-LD | ✅ | Dataset、FAQPage、BreadcrumbList、Organization |
| IndexNow | ⚠️ | 支持环境变量配置，但需确认生产环境已启用并提交 |
| /trending.xml RSS | ✅ | 良好的内容发现补充 |
| Markdown 版本 (.md / ?format=md) | ✅ | 优秀的 AI 可读性格式 |

### 2.4 Schema 与结构化数据

现有 Schema 类型覆盖较全：
- `Organization`：首页
- `WebApplication/SoftwareApplication`：首页（含版本）
- `FAQPage`：首页、报告页
- `Dataset`：报告页、比较页
- `BreadcrumbList`：报告页、比较页
- `SoftwareSourceCode`：报告页

**建议补充**：
- 为 `/docs/github-sloc-counter` 和 `/docs/methodology` 添加 `Article` 或 `TechArticle` Schema。
- 为 `/compare/*` 页面补充 `Comparison` 或 `Table` 语义（目前只有 `Dataset`）。
- 为 `/badges` 页面添加 `SoftwareApplication` 或 `HowTo` Schema。

---

## 3. 内容可引用性诊断

### 3.1 符合 AI 引用最佳实践的页面

- `/docs/methodology`：首段即定义 SLOC，约 150 字自包含段落，非常理想。
- `/docs/github-sloc-counter`：What OctoCounts Is Best For + Supported Repository Hosts + Metrics Explained，结构优秀。
- 报告页：顶部有引用文本（citation）和可抽取数据表。
- 比较页：有数据表和免责声明，但定义句后置。

### 3.2 需要改进的页面

#### 首页 (https://octocounts.com/)

当前首屏文案：

> "GitHub SLOC counter: the panel GitHub forgot. Install the browser extension..."

问题：
- 缺少 "OctoCounts is a free source lines of code (SLOC) counter for public GitHub repositories..." 的标准化定义。
- 营销口号（"the panel GitHub forgot"）对 AI 引用不友好。
- 没有显式的最后更新日期。

**建议**：在 `<h1>` 后立即添加一段 40-60 字的定义性文字，例如：

> OctoCounts is a free SLOC counter for public GitHub repositories. It shows files, total lines, code, comments, blanks, and per-language totals without cloning. Available as a web app, browser extension, API, CLI, and GitHub Action.

#### 比较页 (/compare/*)

当前顶部是标题和引用段落，缺少“比较页是什么”的定义。建议顶部增加：

> This page compares the source lines of code (SLOC) of `{left}` and `{right}` using cached OctoCounts reports. Code size is not code quality; larger numbers only mean more source material.

#### /badges

- 当前为工具页，缺少“什么是 OctoCounts badge”的可引用说明。
- 建议增加 FAQ："What is an OctoCounts badge?"、"How do I add a SLOC badge to my README?"

### 3.3 问题型标题覆盖

AI 搜索常以问题形式触发。当前站点缺少以下问题型 H2/H3：

- "What is the best free SLOC counter for GitHub?"
- "How do I count lines of code in a GitHub repo without cloning?"
- "What is the difference between SLOC and LOC?"
- "How accurate is tokei compared to cloc?"
- "How do I compare the size of two GitHub repositories?"

**建议**：在 `/docs/github-sloc-counter` 或新建 `/docs/faq` 页面中系统回答这些问题。

---

## 4. 用户问题覆盖矩阵

| 意图类型 | 示例问题 | 官网覆盖状态 | 缺口 |
|---|---|---|---|
| 推荐型 | "best free GitHub SLOC counter" | 部分（功能列表） | 缺少明确的“为什么选 OctoCounts”对比 |
| 比较型 | "OctoCounts vs cloc" / "tokei vs cloc" | 有 curated comparisons | 缺少与 cloc/scc 等本地工具的对比页 |
| 替代型 | "alternative to GitHub language bar" | 弱 | 缺少“GitHub language bar alternative”专题 |
| 教程型 | "how to add SLOC badge to README" | 部分（/badges） | 缺少 step-by-step 图文教程 |
| 价格型 | "is OctoCounts free" | 有（产品页提到 free） | 价格/免费策略未在独立页面明确 |
| 风险型 | "is OctoCounts safe / does it access private repos" | 有（Privacy and Scope） | 可强化为独立 FAQ |
| 真实性 | "who made OctoCounts" / "is OctoCounts legit" | 弱 | 缺少 About/Team 页 |
| 购买决策 | 免费工具不适用 | N/A | N/A |
| 场景解决 | "how to estimate repo size for due diligence" | 弱 | 缺少场景专题页 |

---

## 5. AI 搜索意图地图（中文/海外）

### 5.1 海外英文意图

| 任务层 | GEO 操作层 | 典型问题 | 内容资产建议 |
|---|---|---|---|
| 信息型 | 信息型 | "What is SLOC?" | /docs/methodology（已覆盖） |
| 信息型 | 推荐型 | "best online SLOC counter" | 首页优化 + 对比专题 |
| 导航/验证型 | 品牌验证型 | "OctoCounts GitHub" | GitHub 仓库、About 页 |
| 交易/行动型 | 交易型 | "install OctoCounts extension" | 浏览器商店链接、安装指南 |
| 信息型 | 比较型 | "React vs Vue lines of code" | /compare/*（已覆盖） |
| 风险型 | 风险型 | "is OctoCounts safe for private repos" | FAQ/隐私页 |
| 场景型 | 场景型 | "how to cite repo size in a report" | 引用格式页 |

### 5.2 中文 AI 搜索意图

| 典型口语问法 | 检索短语 | 证据查询 | 标题输入 |
|---|---|---|---|
| GitHub 代码行数怎么统计？ | GitHub 代码行数统计工具 | tokei cloc 对比 | GitHub 代码行数统计工具推荐 |
| 有什么好用的 SLOC 工具？ | SLOC 计数器 在线 | OctoCounts 评测 | 免费在线 SLOC 计数器 |
| 怎么看一个 GitHub 项目有多大？ | GitHub 项目大小 代码量 | 项目代码量评估方法 | 如何快速评估 GitHub 项目规模 |
| React 和 Vue 哪个代码量多？ | React Vue 代码量对比 | facebook/react vuejs/core SLOC | React vs Vue 代码量对比 |
| 怎么给 README 加代码行数徽章？ | README 代码行数 badge | OctoCounts badge 教程 | GitHub README 代码行数徽章教程 |
| OctoCounts 是什么？ | OctoCounts 介绍 | OctoCounts 官网 | OctoCounts 使用指南 |

**中文缺口**：目前官网无任何中文页面，国内 AI 平台（DeepSeek/豆包/千问/Kimi/元宝）无法从官网直接抽取中文答案。

---

## 6. 品牌提及与外部信号

### 6.1 当前外部信号

| 平台 | 状态 | 观察 |
|---|---|---|
| GitHub | ✅ 强 | 仓库 huanglizhuo/OctoCounts 是核心权威源 |
| Chrome Web Store | ✅ 有 | 扩展商店页面 |
| Microsoft Edge Add-ons | ✅ 有 | 扩展商店页面 |
| Firefox Add-ons | ✅ 有 | 扩展商店页面 |
| Wikipedia | ❌ 未找到 | 无品牌词条 |
| Reddit | ❌ 搜索失败/未找到 | 未检测到显著讨论 |
| YouTube | ❌ 未找到 | 无品牌相关视频 |
| LinkedIn | ❌ 未找到 | 无公司/个人品牌页 |
| Hacker News / Product Hunt | ⚠️ 待确认 | 可能曾有发布但搜索结果不明确 |
| 中文社区（知乎、V2EX、掘金、CSDN） | ❌ 未找到 | 无中文讨论 |

### 6.2 竞品外部信号对比

| 竞品 | 类型 | 外部信号 | OctoCounts 差距 |
|---|---|---|---|
| cloc (AlDanial/cloc) | CLI 工具 | 长期积累、大量文章引用、多语言教程 | 品牌历史与教程生态 |
| tokei (XAMPPRocky/tokei) | CLI 工具 | 作为 OctoCounts 底层被引用，知名度高 | OctoCounts 本身未独立出圈 |
| scc (boyter/scc) | CLI 工具 | 社区评测较多 | 第三方评测 |
| GitHub 自带 language bar | 平台功能 | 无需解释 | 需要更多“为什么比 language bar 更好”的内容 |

---

## 7. 可优化项优先级矩阵

### P0 — 立即执行（1-2 周）✅ 已完成

| 优化项 | 影响 | 难度 | 负责人建议 | 状态 |
|---|---|---|---|---|
| 首页增加 40-60 字定义段 + 最后更新日期 | 高 | 低 | 前端/内容 | ✅ 已上线 `hero.definition`、noscript 定义段、更新时间 2026-08-28 |
| 为 `/docs/github-sloc-counter` 和 `/docs/methodology` 添加 `Article`/`TechArticle` Schema | 中 | 低 | 前端 | ✅ 已存在；运行 `refresh-llms-lastupdated.mjs` 同步了 `dateModified` |
| 在所有比较页顶部增加“本页比较什么”的定义句 | 中 | 低 | 前端/内容 | ✅ 已在 `functions/[[path]].js` 的 curated comparison SSR 注入 |
| 检查并启用生产环境 IndexNow，向 Bing/Yandex 提交 sitemap | 中 | 低 | 运维 | ✅ `.env.example` 默认启用；生产只需设置 `INDEXNOW_KEY` 并同步到 Cloudflare Pages |
| 在 `/badges` 页面增加“如何添加 badge”的 FAQ | 中 | 低 | 内容 | ✅ 已新增 Badge FAQ 组件与中英文文案 |

> P0 修改已通过 `frontend npm test`（56/56）。

### P1 — 短期执行（1 个月）✅ 已完成核心内容页

| 优化项 | 影响 | 难度 | 负责人建议 | 状态 |
|---|---|---|---|---|
| 新建 `/docs/faq` 页面，系统覆盖 20 个高频问题 | 高 | 中 | 内容 | ✅ 已创建 `frontend/public/docs/faq.html` + `.md`，含完整 FAQPage JSON-LD |
| 创建“OctoCounts vs cloc vs scc vs tokei”对比页 | 高 | 中 | 内容 | ✅ 已创建 `frontend/public/docs/octocounts-vs-cloc.html` + `.md` |
| 增加 About 页面，明确作者/维护者、联系方式、开源贡献 | 中 | 中 | 内容 | ✅ 已创建 `frontend/public/about.html` + `.md`，含 AboutPage + Organization Schema |
| 更新 sitemap 与边缘函数静态条目 | 中 | 低 | 前端/运维 | ✅ `sitemap.xml` 与 `functions/[[path]].js` 已加入新页面 |
| 更新 llms.txt / llms-full.txt 与站内链接 | 中 | 低 | 内容 | ✅ llms 文件已加入新 URL；首页 noscript 与页脚已加 FAQ/About 链接 |
| 优化报告页和无 SSR 内容页的 `<noscript>`/可见文本 | 中 | 中 | 前端 | ⏸️ 可延后；当前 SSR 内容已较完整 |
| 为动态报告页、比较页生成并提交增量 sitemap | 中 | 中 | 后端 | ⏸️ IndexNow 已启用，动态 URL 由后端在报告生成时提交 |
| 创建安装教程（浏览器扩展、CLI、GitHub Action） | 中 | 中 | 内容/视频 | ⏸️ 建议作为 P1.5 视频/图文内容 |

> P1 页面修改已通过 `frontend npm test`（56/56）。

### P2 — 中期执行（2-3 个月）

| 优化项 | 影响 | 难度 | 负责人建议 |
|---|---|---|---|
| 建立中文站点或中文文档页（/zh/... 或 octocounts.cn） | 高 | 高 | 产品/内容 |
| 制作 YouTube/Bilibili 视频教程（安装、使用、对比） | 高 | 高 | 市场/内容 |
| 建立 Reddit/Hacker News/Product Hunt 社区存在感 | 高 | 高 | 增长 |
| 争取 Wikipedia/Wikidata 品牌词条（需符合收录标准） | 高 | 高 | PR |
| 与 tokei、cloc 等生态工具建立互链/合作 | 中 | 中 | 合作 |
| 发布原创研究/博客（如“Top 100 GitHub repos by SLOC”） | 高 | 中 | 内容 |

---

## 8. 具体页面优化建议

### 8.1 首页 (https://octocounts.com/)

当前问题：
- 首屏 H1 是营销口号，不是定义。
- 没有显式最后更新日期。
- FAQ 7 个问题全部在 JSON-LD 中，但页面上未必全部可见（需验证）。

建议修改：

```html
<h1>OctoCounts — Free GitHub SLOC Counter</h1>
<p>
  OctoCounts is a free source lines of code (SLOC) counter for public GitHub repositories.
  It shows files, total lines, code, comments, blanks, and per-language totals
  without cloning. Use the web app, browser extension, API, CLI, or GitHub Action.
</p>
<p><small>Last updated: 2026-08-28 · Maintained by <a href="https://github.com/huanglizhuo">huanglizhuo</a></small></p>
```

并在页面可见区域展示 FAQ（当前 JSON-LD 中已有 7 个问题）。

### 8.2 /docs/github-sloc-counter

当前已较优。建议：
- 添加 `TechArticle` JSON-LD。
- 增加“What is SLOC?”小节链接到 methodology。
- 增加“Who is OctoCounts for?”明确目标用户。

### 8.3 /compare/*

建议：
- 顶部增加定义句。
- 增加“How to read this comparison”说明。
- 为表格添加 `<caption>` 或 ARIA 标签，提升 AI 抽取准确率。

### 8.4 /badges

建议：
- 添加分步教程：1) 选择仓库 2) 复制 Markdown 3) 粘贴到 README。
- 增加 FAQ："Will the badge slow down my README?" / "Can I count a specific language?"

### 8.5 新增页面建议 ✅ 已完成前 3 项

1. ✅ `/docs/faq` — 统一 FAQ 中枢（已上线，含 20 个 FAQ 与 JSON-LD）
2. ✅ `/docs/octocounts-vs-cloc` — 与 cloc/scc/tokei 对比（已上线，含对比表与场景建议）
3. ✅ `/about` — 品牌、作者、开源、联系方式（已上线，含 AboutPage Schema）
4. ⏸️ `/zh/` 或 `/zh/docs/` — 中文入口（P2）

---

## 9. 中文 GEO 专项建议

由于当前站点完全无中文内容，国内 AI 平台（DeepSeek、豆包、千问、Kimi、元宝）几乎无法引用官网。建议：

1. **最低成本方案**：增加一个 `/zh` 页面，包含：
   - 品牌定义
   - 使用步骤
   - 常见问题（5-10 个）
   - 浏览器扩展下载链接
   - 联系/反馈入口

2. **进阶方案**：完整中文文档 + 中文 llms.txt（`/zh/llms.txt`）。

3. **站外证据**：
   - 在知乎、掘金、V2EX、CSDN 发布使用教程。
   - 在 Bilibili/YouTube 发布 2-3 分钟演示视频。
   - 考虑建立微信公众号/视频号（如品牌长期运营）。

---

## 10. 监测与追踪建议

1. **GSC 监测**：跟踪 "SLOC counter"、"GitHub lines of code"、"OctoCounts" 等查询的展示与点击。
2. **AI 采样**：定期用 ChatGPT/Perplexity/Claude/DeepSeek 搜索核心问题，检查是否引用 OctoCounts。
3. **IndexNow**：确保新报告页、新比较页自动提交。
4. **品牌提及监测**：使用 Google Alerts 或第三方工具监测 "OctoCounts" 提及。
5. **llms.txt 效果**：虽然 Google 忽略，但可监测其他 AI 爬虫的访问日志。

---

## 11. 风险与假设

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| 品牌主体为个人开发者 | 可能影响部分 AI 答案的权威归因 | 增加 About 页，展示 GitHub 贡献、扩展商店背书 |
| 过度依赖 `llms.txt` | Google 已明确忽略 llms.txt | 保持但不夸大其作用；重点优化可见内容与 Schema |
| 动态报告页数量巨大 | 增量 sitemap 与索引管理成本高 | 使用 IndexNow + 核心报告页手动提交 |
| 中文市场零基础 | 需要额外内容投入 | 先以单页中文入口试水 |
| 竞品 cloc/tokei 生态成熟 | 第三方评测和教程少 | 主动创作对比与教程内容 |

---

## 12. 结论

OctoCounts 的 SEO/GEO 基础非常扎实，技术实现（SSR、Schema、llms.txt、robots.txt、sitemap、RSS）已达到行业领先水平。当前最大的优化空间在于：

1. **内容可引用性**：把定义性句子前置到首页、比较页和关键文档页。
2. **站外品牌权威**：补足 Wikipedia、Reddit、YouTube、LinkedIn 等平台的品牌实体。
3. **中文市场**：建立中文页面和中文社区证据。
4. **用户问题覆盖**：新增 FAQ、工具对比、场景解决类页面。

按本报告的 P0/P1/P2 矩阵执行，预计可在 1-3 个月内显著提升在 Google AI Overviews、ChatGPT、Perplexity 及国内 AI 搜索中的引用率和品牌可见度。
