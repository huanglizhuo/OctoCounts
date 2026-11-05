# OctoCounts 内容与 GEO 审查

审查日期：2026-11-05（Asia/Singapore）。来源：项目当前工作区、已发布静态内容源、公开官方工具文档。采用 ai-seo、geo-content 技能的内容结构、证据、引用、跨格式一致性检查；不把技能里的流量增幅、最低字数或 AI 引用“概率”当作事实或排名承诺。

## 结论

站点内容基础已完善：17 篇英文指南、2 篇中文指南、独立 docs 导航、About、可追溯研究和 Markdown 副本。主要收益来自纠正少量事实和可复制示例，而不是继续批量增加相近关键词页面。研究原始数据、commit/engine/policy 三元条件和长期保存警告是本站最有价值的可引用内容。

本次没有虚构作者资历、外链、使用人数、排名、benchmark 或引用率。没有增加依赖或页面，没有改研究数据、extension 用户改动、functions 或 prerender 脚本。

## 已实施

| 优先级 | 页面 | 原问题 | 完成修复 |
|---|---|---|---|
| P1 | /docs/github-api-count-lines | Python 示例无限轮询，无网络超时；failed 后仍读取 reportId；“三次请求”掩盖异步任务 | 30 秒网络超时、5 分钟轮询期限、显式 failed 异常、输出 jobId 便于恢复；明确三类 endpoint 与重复 polling；Python-only 标题与实际示例一致 |
| P1 | /docs/count-lines-of-code-github | git ls-files 管道损坏空格/换行文件名；wc 说成真正源码行计数 | NUL 分隔、wc 的 -- 参数；准确说明 newline、未终止行、二进制和 xargs 分批总数限制 |
| P2 | /docs/faq | 未限定“通常几秒”；列出不存在的 job 列表功能；把 tokei/OctoCounts 输出格式当相同；SLOC 复杂度推断 | 说明仓库/上游/队列影响；单 job 状态查询；区分报告格式；明确 SLOC 不衡量复杂度、质量、生产率、工作量；说明 CLI 需要 Node.js/npm |
| P2 | /docs/glossary | code share 误称 comment ratio 的补集，遗漏 blank share | 明确 code/comments/blanks 三项占比关系 |
| P2 | /docs/tokei-online | 声称 badge 有 comment share；实际 ratio 是 code share | 改为 comment lines 与 code share，HTML/Markdown/FAQ schema 一致 |
| P2 | /docs/github-language-bar-alternative | 把 GitHub 用字节统计的原因推断为计算更便宜 | 删除推断，解释公开指标并链接 GitHub REST 和 Linguist 一手规则 |
| P2 | 五篇工具比较指南 | 无证据的维护状态/社区大小/性能差异、错误归档输入、scc license/重复代码块声明 | 依据 upstream README 删除主观断言；明确本地源码与解压归档、cloc 直接归档输入和独立 Windows binary、tokei 预构建 binary；scc 改为重复文件过滤，并同步 schema |
| P2 | /docs/api、/contact、/privacy | 静态正文缺少 main landmark | 增加 main 语义容器，正文与日期不变 |

十一篇有真实内容变化的指南同步可见日期、TechArticle.dateModified、Markdown 日期和 content-manifest 为 2026-11-05。functions 的 sitemap mirror 由主 agent/technical owner 同步。

## 详细覆盖记录

| 内容面 | 审查结果 | 后续关注 |
|---|---|---|
| /docs 导航 | 计数、工具对比、研究、参考、中英文分类清楚；所有主题有入口 | 用 Search Console 查询数据判断链接权重，勿盲目再加导航项 |
| github-sloc-counter | 作为 pillar，包含流程、真实例子、选项、分享/保存限制、16 篇子指南链接 | React 历史例子的链接仍指 live report；正文已标注日期，但应逐步把可核验数据链接指向归档完整记录 |
| count-lines-of-code-github | 四种工作流、指标、私有仓库边界清楚 | 已修命令安全与 wc 语义；无需按编程语言复制几十个薄页面 |
| count-lines-without-cloning | 说明 archive 与 clone、export-ignore/export-subst 差异，引用样本研究 | “fastest”问法仍仅适合说明缓存情形，不应用旧 pilot 推断冷启动性能 |
| github-api-count-lines | 从字节指标到三阶段任务生命周期路径清楚 | 已修真实示例；无需再创建 JavaScript 专页，可靠自动化用已有 CLI/SDK 文档 |
| github-repository-size-checker | 区分历史体积与单快照行数，有具体数字和时间 | 旧大小数字与短 SHA 没有同等完整证据；下轮刷新应保留原始 API 响应、日期、完整 SHA；不能只是换日期 |
| tokei-online | 清楚解释 server-side tokei、私有代码使用本地 CLI、计数规则 | 已纠正 badge 指标；与 vs-tokei 有意图重叠，需搜索查询数据后决定合并或保留 |
| methodology（EN/ZH） | pinned commit、engine 15.0.0、过滤规则、声明模式、缓存留存限制齐全 | 版本升级必须与 Cargo.lock 和报告实际版本一致；不能把旧研究重标为新版本测量 |
| glossary | physical/logical、code/comment/blank、delta 形成可引用定义 | 已修 ratio；无需机械加长每段来满足某技能字数分 |
| faq | 用户问题覆盖充分，schema 和可见答案并存 | 已纠正功能/性能/输出/复杂度表述；以后以产品事实检查器约束新增表述 |
| octocounts-vs-cloc | 工作流表、cloc 命令映射、私有场景推荐本地工具 | 已修正本地源码/归档输入与安装要求；--vcs=git 映射已明确不等于 Git-tracked-files 模式 |
| octocounts-vs-tokei | 同引擎不同服务方式、版本和有效规则说明较好 | 已把 tarball 输入改为 extracted source archive，删除未证实的使用普及叙述；引擎升级仍需核对实际生产版本 |
| octocounts-vs-scc | 区分 complexity/COCOMO 与线数，明确无可用受控速度比较 | 已删除 typical-difference 假设；按 upstream --no-duplicates 修正为重复文件过滤，排除重复代码块/许可证分析的误述 |
| tokei-vs-cloc-vs-scc | 比较选项和输出，而非发布伪 benchmark | 已移除 license detection 误述与实现语言隐含的性能排序，补充无需 clone 的本地归档工作流 |
| best-sloc-counter-tools | 六种工具按场景比较，明确自身是其中之一 | 已删除无证据的维护状态/社区规模/安装难度判断，以 upstream 支持语言和安装文档为准；明确 SLOC 与额外复杂度估计不同 |
| github-language-bar-alternative | bytes 与 lines 不可互换的解释、扩展入口和 docs 内链齐全 | 已移除未经证实的 GitHub 产品动机/性能推断 |
| largest-codebases | 八仓库历史快照与版本化 JSON，明确非穷尽榜单、旧计数不等于当前生产引擎 | 下一次采集应每条保存完整 report/policy/full SHA，不只表格与短 SHA；旧资料保留原日期 |
| research | 10 仓库 × 5 配置原始完整记录、50 次成功、七生态 convenience sample、明确限定结论、collector hash；原 pilot 独立保留 | 最强 GEO 资产。扩展研究应先定义采样设计及问题；测试目录排除不能改称全部测试代码比例；避免把 request wall time 说成受控引擎速度 |
| about/contact/privacy | 有实名 GitHub 身份、MIT 源码、issue 联系渠道、隐私说明，无虚构资历 | 已补 contact/privacy main；不为凑 E-E-A-T 分数添加不存在的公司地址/认证/客户证言 |
| 中文指南 | 独立正文、非英文页面 query 变体；方法与引用限制准确 | 目前只做核心两指南；先观察中文查询需求再扩张，保持翻译版本同步 |
| llms.txt / llms-full.txt | 已有索引、完整事实、方法、API、保存限制、中文链接与比较列表；不需要再次创建 AI 文件 | 它们是补充导航，不宣称 Google AI 必需、保证采用或可提高固定百分比 |

## 结构检查

对 frontend/public 下 25 个 HTML 文件（含 404）扫描：均只有一个 H1；发现的 img 均有 alt；JSON-LD 均可解析。英文指南多数约 500–2,000 空格分词，足够由内容本身回答问题；中文空格分词不能用于英文长度评分。初次 inventory 的 api/contact/privacy words=0 是因为它们当时没有 main，而非无正文；本轮已修容器。原始结构清单见 content-inventory.json。

## 验证

- node scripts/check-product-facts.mjs：通过，57 个文件。
- node --test frontend/tests/seo-content-regressions.test.mjs：2/2 通过，检查日期一致性与引用条件跨格式一致。
- 从 Markdown 提取实际 Python 示例，与 HTML 解码内容严格相等；使用 unittest.mock/标准库模拟 completed、failed、超时，确认 failed/超时不会读取 report，所有网络调用设置 timeout；通过，无外部 API 调用。
- 从 Markdown 提取实际 git/wc 命令，在 /tmp 临时 git repo 中创建空格、换行、前导减号文件名，实际执行得到正确总数 6；通过。
- git diff --check：通过。
- 全站 npm test 与线上渲染验证由主 agent 统一执行。

## 后续优先顺序与可证伪检查

1. **一周内：证据完整性。** 优先为旧 worked examples/规模榜单补完整归档引用，而不是重新组织文字。成功标准：每个公开精确数值都能定位到对应 versioned JSON 行；失败信号：只能指向移动的 live report。
2. **已完成：竞争工具事实。** 核对 tokei/cloc/scc README 与 SLOCCount 官方主页，删除不维护/社区更小/安装更难/典型计数差异等无证据判断，纠正重复文件过滤和源码输入。持续检查：每次编辑比较表均回查 upstream 版本，不把工具作者自称速度等同于本站受控 benchmark。
3. **一个月：意图重叠。** 从 GSC 导出 query×page：tokei-online/vs-tokei、count-lines/count-without-cloning、best-tools/tool-comparison。只有出现同意图分散且页面无法区分价值时才合并并做 301；当前不能仅凭相似标题判断 cannibalization。
4. **一个月：原创研究分发与复现。** 使用既有研究、固定命令和完整数据吸引自然引用；不批量发布“最佳工具”页面。领先指标：研究页外链、非品牌查询曝光、下载/引用动作；后验检查：外部引用是否保留样本和日期限定。
5. **持续：多平台 AI 观察。** 选择 10–20 个能带来分析使用的查询，每平台每查询重复 3–5 次，记录答案日期、真实 citation URL 和样本量；未运行前不报告“AI 可见度分数”。

## 一手资料

- GitHub REST repository languages：https://docs.github.com/en/rest/repos/repos#list-repository-languages
- GitHub Linguist counting rules：https://github.com/github-linguist/linguist/blob/main/docs/how-linguist-works.md
- Git filename quoting/NUL output：https://git-scm.com/docs/git-ls-files
- cloc upstream：https://github.com/AlDanial/cloc （文件/目录/归档输入与 Windows 独立 binary）
- tokei upstream：https://github.com/XAMPPRocky/tokei （目录输入、安装、output flags）
- scc upstream：https://github.com/boyter/scc （--no-duplicates、complexity、COCOMO；未发现 license detection 功能承诺）
- SLOCCount 官方主页：https://dwheeler.com/sloccount/ （支持语言、安装、估计校准限制）

未检查：付费外链数据库、Search Console 私有查询数据、跨 AI 平台重复采样、每个外部工具当前发行版的完整功能回归；未重新采集历史研究。
风险：本次提升内容准确性和可读取性，不能据此保证排名或 AI 引用提升；部署后需观察索引与真实查询数据。
