# OctoCounts GEO/SEO 分析报告

生成日期:2026-09-16。审计范围:仓库内 frontend(静态资产 + Cloudflare Pages Functions SSR)、docs、scripts;线上行为(Cloudflare 规则、Bing/GSC 数据)无法从仓库验证的部分已标注。

---

## 1. GEO 就绪评分:78/100

| 维度 | 得分 | 说明 |
|---|---|---|
| 技术可访问性(robots/llms/SSR/sitemap) | 90 | robots 全面放行 AI 爬虫、llms.txt 结构完整、关键页边缘 SSR;扣分项:Bytespider 未表态、生产验证未做 |
| 结构化数据 | 85 | 11 文件 33 处 JSON-LD,类型齐全;扣分项:静态 docs 页缺 BreadcrumbList/Speakable |
| 段落可引用性 | 75 | FAQ 答案块质量高;扣分项:缺页首 40-75 词"答案胶囊"、api.html 结构化最弱 |
| 内容覆盖率 | 55 | 编辑内容仅覆盖 5/103 对比页;研究试点未发布;扣分最重 |
| 新鲜度 | 65 | manifest 机制防日期虚刷(好),但正文可见 "Updated" 与 JSON-LD 系统性不一致 |
| 权威/品牌信号 | 60 | 作者署名+GitHub+商店外链齐全;缺 YouTube、Reddit/Wikipedia 提及、原创公开研究 |
| 测量闭环 | 30 | GSC/Bing/umami 全部 "unknown",基线未建,无法验证任何优化效果 |

## 2. 平台分面评分(预估)

| 平台 | 评分 | 依据 |
|---|---|---|
| Google AI Overviews / AI Mode | 75 | 传统 SEO 基础好(schema、SSR、FAQ),但缺顶部答案胶囊与可见新鲜度信号 |
| ChatGPT | 70 | robots 放行 + llms.txt + Markdown 格式协商做得好;Wikipedia/Reddit 实体提及缺失是短板 |
| Perplexity | 65 | 放行 PerplexityBot,但 Reddit 提及(其最大引用来源)为零;时效性数据页有优势 |

## 3. AI 爬虫访问状态

`frontend/public/robots.txt`:

| 爬虫 | 状态 |
|---|---|
| GPTBot / OAI-SearchBot / ChatGPT-User / ClaudeBot / anthropic-ai / PerplexityBot / Google-Extended / Applebot / CCBot | ✅ Allow |
| Bytespider | ❌ 未出现(无意遗漏,应在 robots 显式表态并更新 `docs/ai-crawling-policy.md` 矩阵) |

## 4. llms.txt 状态

✅ 已存在且结构完整(`frontend/public/llms.txt`,188 行,含 Short Answer、API 摘要、103 个对比页列表、Recommended Citation;`llms-full.txt` 互相链接)。`Last-Updated: 2026-09-08`。

注意:Google 官方 2026-06 明确 llms.txt 对搜索排名无效,它只服务非 Google AI 系统——保持现状即可,不要指望它影响 Google。

## 5. 品牌提及分析

- GitHub:作者实体 + 源码仓库 + 3 个浏览器商店链接多处 sameAs,✅ 强。
- Wikipedia / Wikidata:❌ 无实体条目(该品类 cloc 有条目,长期机会)。
- Reddit / Stack Overflow:❌ 无自然提及(Perplexity 引用来源 46.7% 是 Reddit,这是最大短板)。
- YouTube:❌ 无视频(Gemini 大量引用 YouTube,且 YouTube 提及是与 AI 可见性相关性最强的信号 ~0.737)。
- LinkedIn:❌ 未见。

## 6. 段落级可引用性

- ✅ FAQPage 答案块普遍 100-200 词,符合 134-167 词最优区间;问题式标题在 docs 和对比页是自动生成强项。
- ⚠️ 缺"答案胶囊":调研显示页首 40-75 词声明式定义句是最强引用因子,44% 的 AI 引用来自页面上部 30%。当前页面首屏是营销/交互内容,定义句埋在下方。
- ⚠️ `docs/api.html` 是全站结构化最弱页面:8 个名词性标题、无 FAQ 区块。

## 7. SSR 检查

✅ 混合架构合格:报告页/对比页/trending/stats 由 `frontend/functions/[[path]].js` 边缘 SSR 注入完整正文 + JSON-LD + noscript;检索型 AI UA 自动返回 Markdown(`AI_RETRIEVAL_BOT_UA`,:185)。SPA 非覆盖路由(如 /diff)依赖客户端渲染,⚠️ 次要风险。SG-08 生产验证(真实爬虫穿透 Cloudflare 的 5 项复选框)全部未做。

## 8. 影响最大的 5 项改动(按优先级)

1. **修复可见日期与 JSON-LD 日期不一致**(SG-02 残留违规)。docs 页正文 "Updated August 28, 2026" vs JSON-LD `dateModified: 2026-09-08`;`api.html` 可见日期缺失。把 "Updated" 行纳入 `content-manifest.json` 同步机制,由测试断言三处一致。这是搜索引擎判定 dateModified 不可信的典型信号,直接伤害 AI 引用资格。
2. **给每个核心页加 40-75 词页首"答案胶囊"**。格式:"OctoCounts 是一个统计 GitHub 仓库代码行数(SLOC)的在线工具……",胶囊内不放链接。放首页、docs 每页、对比页、报告页。
3. **对比页编辑内容扩量:5/103 → 全量**。SG-05 首批 5 页已验证模式(compare-editorial.js),剩余 98 页按同一 scope/insights/caution/sources 模板补齐,优先级按搜索量排序。
4. **发布原创研究页面 `/research/`**。SG-06 试点(2 仓库×4 配置,filtering-effects 样本)已完成但无公开路由。发布"2026 开源项目 SLOC 基准报告"——原创带日期数据是 AI 和 newsletter 最爱引用的资产,同时是 Reddit/社区讨论的自然钩子。
5. **建立测量基线**(SG-10)。接入 GSC/Bing Webmaster(Bing 索引同时喂 ChatGPT 检索)/umami 任一,每月对 10 个目标提示词测 ChatGPT/Perplexity 引用情况,否则后续所有优化无法验证。

## 9. Schema 建议

- 静态 docs 页补 `BreadcrumbList`(目前只在动态页有)和 `SpeakableSpecification`。
- `Person` 补 `jobTitle`、`image`、`sameAs`(LinkedIn/个人主页);`Organization` 补 `logo`。
- 集成教程类新内容用 `HowTo` schema。
- 首页 SoftwareApplication 不放 aggregateRating 的决策保持不变(合规正确)。

## 10. 内容重构建议(具体)

| 页面 | 动作 |
|---|---|
| 所有核心页首屏 | 加 40-75 词定义式答案胶囊(先放首页 + best-sloc-counter-tools) |
| `docs/api.html` | 重写标题为问题式("How do I authenticate?"、"What endpoints are available?"),加 4-6 问 FAQ 区块 + FAQPage schema |
| `docs/glossary.html` | 天然适合 "X is..." 定义模式,每个术语首句改成可抽取定义句 |
| 对比页(98 个缺内容的) | 每页加 "Which is better for {use case}?" 问题式 H2 + 120-180 词自包含答案 |
| 报告页 | 首段已程序化生成 "SLOCs for {owner}/{repo} is …",保持;确认带统计时间戳(语义时间戳已做,✅) |
| llms.txt | 对照 manifest 核实 Last-Updated;过期 llms.txt 比没有更糟 |

## 11. 权威建设路线(中长期)

1. **GitHub README 引流**:该品类最大流量入口是 cloc 的 GitHub README。给 OctoCounts 源码 README 顶部加 octocounts.com 链接,完善 GitHub topic(count-lines-of-code)下的存在感。
2. **Reddit/Stack Overflow 自然提及**:以开发者身份回答 "how to count lines of code" 类问题(参数化记忆,不带链接也有效)。配合 /research/ 报告发布在 r/programming、r/webdev。
3. **YouTube 60-90 秒演示视频**:扩展演示 + API 演示;Gemini 大量引用 YouTube,YouTube 提及是 AI 可见性最强相关信号。
4. **季度内容刷新节奏**:统计数据页按季度刷新并真实移动日期(机制已有,不要虚刷);每月手动测 10 个提示词。
5. **Bytespider 表态**:robots.txt 显式 Allow 或 Disallow,并同步 `docs/ai-crawling-policy.md` 矩阵。

## 12. 与既有计划的对照(计划有、未执行的 gap)

| 计划项 | 状态 |
|---|---|
| SG-04 报告引用可复现性 | ⚠️ 被 Rust 工具链阻塞,需解除 |
| SG-05 对比页编辑内容 | ⚠️ 5/103,扩量进行中 |
| SG-06 原创研究 | ⚠️ 试点完成,缺 /research/ 公开路由 |
| SG-08 AI 抓取生产验证 | ❌ 5 项复选框全空 |
| SG-09 中文页面 | ⏸️ 用户决策暂缓(维持) |
| SG-10 测量基线 | ❌ 全 unknown |
| §14 发布后效果观察 | ❌ 未开始 |

## 附:调研依据来源

- Oltre.ai《How to get cited by ChatGPT》:答案胶囊、44.2% 顶部引用、query fan-out — https://www.oltre.ai/blog/how-to-get-cited-by-chatgpt
- Averi.ai GEO 指南:品牌提及相关性 0.664 vs 反链 0.218、促销语气 -26% — https://www.averi.ai/learn/the-definitive-guide-to-geo-get-cited-by-ai-in-2026
- vaza.ai llms.txt 指南:Key claims 区结构 — https://vaza.ai/blog/llms-txt-guide-2026
- UltraScout AI 可抓取性审计:90% 失败源于 robots/schema — https://ultrascout.ai/learn/ai-crawler-accessibility-2026-guide
- Otterly.ai GEO 研究:Wikipedia 占 AI 引用链接 9.61% — https://otterly.ai/research/OtterlyAI_Generative_Engine_Optimization_Guide.pdf
- 品类 SERP 观察:"count lines of code" 意图被 GitHub README + 教程博客占据(cloc 先例)——OctoCounts 需同时做工具页、教程、GitHub 资产三类。
