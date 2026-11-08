# OctoCounts SEO 行动计划(2026-10-07)

按 Critical → High → Medium → Low 排序;标注预估工作量。配套详情见 `FULL-AUDIT-REPORT.md`。

## 🔴 Critical(本周内)

| # | 动作 | 工作量 | 对应问题 |
|---|---|---|---|
| C1 | **注册 Bing Webmaster Tools,提交 3 个 sitemap,新报告走 IndexNow** —— 站点当前不在 Bing 索引,等于在 ChatGPT Search 中不存在 | ~1h | GEO |
| C2 | **修 4 个 503 compare 页**(`react-vs-vue`、`angular-vs-react`、`svelte-vs-react`、`docker-vs-podman`):`frontend/functions/[[path]].js` 里让 sitemap 的 `indexableCompareEntries`(~L1526)与页面渲染共享同一存在性判断,或对 registry 对缓存 last-good SSR | ~2h | 技术/Sitemap |
| C3 | **外链冷启动三板斧**:① Product Hunt + AlternativeTo(cloc/SLOCReport 的 alternative 条目)+ DevHunt 提交;② awesome-list PR(analysis-tools-dev/static-analysis、tokei README similar-tools 区);③ 用 /research 的数据发现("X% of React 是测试代码")作为钩子重发 Show HN + 发 r/commandline、r/rust | ~4h + 跟进 | 外链 |
| C4 | **docs 聚类重构**:github-sloc-counter 定为唯一 hub(砍掉与 count-lines-of-code-github 重复的计数原理/指标表/FAQ,补 9-spoke 索引块);count-lines 独占 how-to 意图;给 count-lines/tokei-online/glossary 各补 ≥2 个入链("相关指南"块) | ~4h | 聚类/内容 |

## 🟠 High(1-2 周内)

| # | 动作 | 工作量 |
|---|---|---|
| H1 | 重新生成 `llms-full.txt`:补 MCP server、CLI(`npx octocounts`)、GitHub Action、/compare、/diff 章节;同步 llms.txt 日期 | ~30m |
| H2 | 发布 how-to 页 "4 种方法统计 GitHub 仓库代码行数"(clone+cloc / 在线工具 / 扩展 / API),打 "count lines of code github" | ~3h |
| H3 | 在 github-sloc-counter 与 best-sloc-counter-tools 加 "tokei 无官方 web UI;OctoCounts 在线跑 tokei" 段落,认领零竞争的 "tokei online" | ~20m |
| H4 | 报告页加 "copy badge" 流程,启动 badge 外链飞轮 | ~2h |
| H5 | 对 `*.md` / `?format=md` 响应输出 `X-Robots-Tag: noindex`(边缘规则) | ~30m |
| H6 | 报告页 LCP:og 图转 WebP/AVIF + `fetchpriority="high"`,或经 CF 同域镜像 | ~2h |
| H7 | best-sloc-counter-tools 加带实时数据(星数/最后提交)的对比表;拆 vs-cloc / vs-tokei / vs-scc 子页 | ~4h |
| H8 | 新页 "clone 前先看仓库多大"(仓库体积意图,用现有 API 数据) | ~3h |

## 🟡 Medium(1 个月内)

- M1 首屏社会证明条:GitHub 星数 / 商店评分 / "已分析 N 仓库"(~1h)
- M2 移动端行内链接 min-height 44px(36px 实测)(~1h)
- M3 docs 页补外部引用:工具名链到 cloc/tokei/scc 仓库,COCOMO 注出处;解决 tokei 12.1 vs 14.0.0 版本矛盾(~1h)
- M4 报告语料内链:按 owner 的可浏览索引页或"相关报告"轮换,救活 ~4400 个准孤儿页(~4h)
- M5 compare 页每对加独特叙述(架构/历史),lastmod 改用每对真实刷新日期(~3h)
- M6 Schema 清理:/trending publisher 改 `{"@id":...}`;Person sameAs 全站统一;extension 块补 Edge/Firefox downloadUrl(~1h)
- M7 首页扩展区加商店评分/安装量/侧栏截图(~1h)
- M8 首页移动端 LCP 2.6s→2.5s 内:内联关键 CSS、清 11KB 未用 CSS(~2h)

## 🟢 Low( backlog )

- 删空 `sitemap-reports-2.xml`(空时不输出)
- 308 报告重定向加 CF 缓存规则(现 BYPASS 回源)
- 报告标题口径:"365,008 lines" → "code lines(排除测试)" + 配置注明
- "Similar repository reports" 过滤低质相似项
- Dataset dateModified 截到毫秒精度
- FAQ 定义去重("What is SLOC" 收敛到 methodology)
- 缺口页 backlog:COCOMO 计算器、cloc online、scc vs cloc、sloccount alternative
- CSP `style-src 'unsafe-inline'`(安全卫生,无 SEO 影响)

## 关键指标追踪

1. Bing 索引页数(WTM `site:octocounts.com`)
2. 提及/外链域名数(每月 Common Crawl + WebSearch 复查)
3. "count lines of code github"、"tokei online"、"github sloc counter" 排名
4. badge 嵌入的外部 repo 数
