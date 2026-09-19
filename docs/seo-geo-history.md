# OctoCounts SEO/GEO 历史与状态(合并档案)

> 本文档合并并取代了四份历史文档:`docs/research/GEO-optimization-report.md`(2026-08-28 诊断)、`GEO-ANALYSIS.md`(2026-09-16 快照)、`SEO-GEO-optimize-plan.md`(2026-09-08 计划,第 1–3 轮)与根目录的 `SEO-INDEX-GEO-PLAN-2026-09-19.md`(第 4 轮,已移至本目录)。当前活跃文档:**[seo-geo-plan-2026-09-19.md](seo-geo-plan-2026-09-19.md)(第 4 轮方案)、[seo-index-runbook.md](seo-index-runbook.md)(部署手册)、[seo-geo-measurement.md](seo-geo-measurement.md)(SG-10 测量)、[ai-crawling-policy.md](ai-crawling-policy.md)(爬虫策略)**。

## 1. 四轮时间线

| 轮次 | 日期 | 范围 | 状态 |
|---|---|---|---|
| 诊断 | 2026-08-28/29 | 三个 GEO skill 综合诊断 + 8 专项 agent 复核(技术 SEO、Schema、内容、sitemap、性能、SXO、外链、GEO) | 完成,问题流入第 1–3 轮 |
| 第 1–3 轮 | 2026-09-08 计划,09-16/17 部署 | SG-01…SG-10 任务(见 §2) | 完成(遗留见 §4) |
| 第 4 轮 | 2026-09-19 | sitemap 拆分、llms 移出 XML sitemap、FAQ 可引用性、IndexNow 验证/推送 | 完成,方案见 [seo-geo-plan-2026-09-19.md](seo-geo-plan-2026-09-19.md) |

## 2. 第 1–3 轮(SG-01…SG-10)做了什么

- **SG-01 SSR 一致性**:对比详情页 SSR 与客户端同源 view model,JS 开/关内容一致。
- **SG-02 产品事实统一**:`content/product-facts.json` + `npm run test:facts` 门禁,清理 GitLab 声明与不可证性能声明。
- **SG-03 扩展落地页** `/extension`:完整 SSR + 三商店链接。
- **SG-04 报告可复现**:报告页带 commit SHA、分析配置、"Reproduce this exact report" 入口。
- **SG-05 对比页编辑内容**:101/101 页补 scope/insights/caution/sources(`functions/compare-editorial.js`)。
- **SG-06 原创研究** `/research`:filtering-effects 试点(2 仓库 × 4 配置,8/8 成功,单次 1.2–1.9s;核心发现:排除测试使 code 行数降 26.6%(vite)至 47.7%(react)),数据 `research/filtering-effects/`。
- **SG-07 lastmod 诚信机制**:`content/content-manifest.json` 为事实源,"不为刷新日期而刷新日期"。
- **SG-08 AI 抓取验证**:部分完成;IndexNow key 文件验证已在第 4 轮补上(`resubmit-urls-indexnow.mjs --verify-key`),真实爬虫穿透验证仍待做。
- **SG-09 中文页**:用户决策暂缓(要点存档见 §5)。
- **SG-10 测量**:事件字典已实现(`docs/seo-geo-measurement.md`),GSC/Bing/umami 基线仍缺后台权限。

2026-09-16/17 部署的第三轮还包括:全站 40–75 词答案胶囊(首页/9 docs/101 对比页/报告页)、docs 日期三处一致性(可见日期 = JSON-LD = manifest = sitemap)、robots.txt 显式放行 Bytespider、api.html 问题式标题 + FAQPage、docs 补 BreadcrumbList/Speakable、Person 补 jobTitle/image。

2026-08-29/09-05 的诊断复核曾修复:首页不可见的 aggregateRating schema(合规风险)、残留 HowTo schema、动态页尾斜杠 200→308 归一、伪造仓库路径软 404(后端存在性校验)。

## 3. 第 4 轮(2026-09-19)摘要

诊断:单一 `/sitemap.xml` 混入 3,989 个程序化 `/github/*` 报告页(97%),新站爬行预算被淹没 —— `site:octocounts.com/compare` 收录为 0;llms.txt/llms-full.txt 作为 text/plain 混在 XML sitemap。

修复:`/sitemap.xml` 改为 sitemap index(static 22 页 / compare ~100 页 / reports 每片 ≤10k);llms*.txt 移出所有 XML sitemap;FAQ 11 个答案扩为自包含答案块(citability 41.5→51.1,F 级 9→0);IndexNow 脚本 `--verify-key` / `--core`;Cloudflare 缓存规则与健康检查同步覆盖子 sitemap(sloc-infra)。详见 [seo-geo-plan-2026-09-19.md](seo-geo-plan-2026-09-19.md) 与 [seo-index-runbook.md](seo-index-runbook.md)。

**决策记录**:报告页 sitemap lastmod 保持 = 报告 `generatedAt`(页面可见快照时间确实随重分析更新,语义诚实;分片后变动噪音不再污染核心页)。

## 4. 遗留开放项

| 项 | 说明 |
|---|---|
| SG-08 剩余 | 真实 Googlebot/Bingbot/GPTBot 穿透 Cloudflare 的生产验证(5 项复选框) |
| SG-10 基线 | GSC/Bing Webmaster/umami 后台接入,每 2 周对照 runbook §5 指标 |
| 报告页/对比页程序化段落 | citability 39–49,可程序化强化(第 4 轮只做了 FAQ) |
| GSC/Bing 手动步骤 | 部署后按 runbook §3/§4 执行(重新提交 sitemap、请求收录、--core 推送) |

## 5. 中长期路线(自旧档案合并,仍然有效)

### 5.1 权威/品牌提及(GEO 评分最大短板)

- **现状**:GitHub + 三浏览器商店强;HN 帖(2026-07-16,2 赞)、`ruanyf/weekly` issue(2026-07-01)是仅有的自然外触点;Reddit/YouTube/Wikipedia/LinkedIn/中文社区(知乎、V2EX、掘金、CSDN)零提及。
- **差距对标**:cloc 有大量第三方教程与引用(品类最大流量入口是其 GitHub README);tokei 作为 OctoCounts 底层被提及但 OctoCounts 未独立出圈;scc 有社区评测。
- **行动**:① 源码 README 顶部加 octocounts.com 链接 + 完善 GitHub topic;② 以开发者身份回答 "how to count lines of code" 类 Reddit/SO 问题;③ YouTube/Bilibili 60–90 秒演示(YouTube 提及是 AI 可见性最强相关信号 ~0.737);④ 季度刷新统计页并真实移动日期。

### 5.2 搜索意图地图(2026-08-28 调研,指导内容资产)

海外已覆盖:What is SLOC(/docs/methodology)、best SLOC counter(首页+对比专题)、React vs Vue lines of code(/compare/*)、is OctoCounts safe(FAQ/隐私)。仍缺:引用格式专页("how to cite repo size in a report")、安装指南深化。

中文缺口:官网无中文页面,国内 AI(DeepSeek/豆包/千问/Kimi/元宝)无法从官网抽取中文答案。若启动 SG-09,最低成本为单页 `/zh`(品牌定义、步骤、5–10 FAQ、商店链接);进阶为中文文档 + /zh/llms.txt;站外在知乎/掘金/V2EX 发教程、Bilibili 发演示。高频中文意图:GitHub 代码行数怎么统计 / SLOC 计数器在线 / React Vue 代码量对比 / README 代码行数徽章。

### 5.3 GSC/Bing 观察节奏

每 2 周按 runbook §5 指标核对(对比页收录从 0 增长、docs 8 页全收录、核心子片收录率 >80%、AI 引用手测)。
