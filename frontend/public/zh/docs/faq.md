# OctoCounts 常见问题

更新于 2026-11-25 · 维护者：[huanglizhuo](https://github.com/huanglizhuo)

OctoCounts 是免费的公开 GitHub 仓库代码行数统计工具。它不克隆仓库，而是将所选分支、标签或提交 SHA 解析为确定的提交，下载对应源码归档，使用 [tokei](https://github.com/XAMPPRocky/tokei) 统计文件数量、总行数、代码行、注释行、空白行及按语言汇总，并可导出纯文本、JSON 或 PNG 卡片。

规范页面：https://octocounts.com/zh/docs/faq

[中文首页](https://octocounts.com/zh) · [SLOC 使用指南](https://octocounts.com/zh/docs/github-sloc-counter) · [计数方法](https://octocounts.com/zh/docs/methodology) · [English version](https://octocounts.com/docs/faq) · [Markdown 版本](https://octocounts.com/zh/docs/faq.md)

## 开始使用

### OctoCounts 是什么？

OctoCounts 是免费的公开 GitHub 仓库源代码行数（SLOC）统计工具。它不克隆仓库，而是将所选分支、标签或提交 SHA 解析为确定的提交，下载对应源码归档，使用 tokei 统计文件数量、总行数、代码行、注释行、空白行及按语言汇总，并可导出纯文本、JSON 或 PNG 卡片。无需注册，浏览器直接使用。

### SLOC 是什么？

SLOC 是 Source Lines of Code（源代码行数）。它用于衡量程序规模，区分代码行、注释行与空白行：一个 10,000 行且 40% 为注释的文件，说明和 95% 为代码的 10,000 行文件完全不同。SLOC 可帮助描述源码规模、在匹配规则下比较依赖占用并跟踪版本变化，但不能衡量复杂度、代码质量、生产力或开发投入。OctoCounts 按语言和全仓库汇总两级报告 SLOC，底层统计引擎是以 Rust 编写的 tokei。

### 如何统计 GitHub 仓库的代码行数？

打开 octocounts.com（或中文首页 octocounts.com/zh），粘贴公开 GitHub 仓库地址，例如 github.com/torvalds/linux，可选选择分支、标签或提交 SHA，然后点击分析。OctoCounts 将 ref 解析为确定的提交，下载源码归档，运行 tokei，返回可排序的按语言细分和汇总统计，无需 git clone。分析耗时取决于仓库大小、上游访问和队列负载。每次分析都会得到可分享的报告链接，可被引用或再次访问。

### OctoCounts 是否免费？

是的。OctoCounts 对公开 GitHub 仓库完全免费：无需注册、无 API key、无登录，默认每 IP 5 次/分钟的分析限制（突发 10 次）。网页应用和浏览器扩展都免费，没有高级版。后端以 Rust 和 Axum 编写，前端为 React 与 TypeScript；源码在 GitHub 上开源（MIT），也可自托管整个栈。OctoCounts 只分析公开仓库，不接受源码上传，没有广告。网站使用聚合统计，Chrome 扩展提供可选的 GitHub 登录；数据处理详见隐私政策。

## 功能与集成

### OctoCounts 有浏览器扩展吗？

有。OctoCounts 为 Chrome、Edge、Firefox 提供扩展，全部命名为 OctoCounts – GitHub SLOC & Code Statistics。在 GitHub 仓库侧边栏直接显示紧凑的 SLOC 卡片，自动出现在任意公开仓库页面上，显示总行数和分析状态。点击卡片展开完整面板，显示按语言细分的文件数、总行数、代码行、注释行和空白行。本地缓存让重复访问同一仓库和 ref 可复用已保存结果。无需 GitHub 账号或 API token；扩展源码公开在 GitHub 上。

### 支持哪些编程语言？

OctoCounts 使用 tokei 进行语言识别，支持 200 多种编程语言和文件类型，包括 Rust、Python、JavaScript、TypeScript、Go、Java、C、C++、C#、Ruby、Swift、Kotlin、PHP、Scala、Haskell、Elixir、Erlang、Clojure、F#、Lua、R、Julia、Dart、Perl、Shell、Bash、PowerShell、HTML、CSS、SCSS、SQL、GraphQL、Dockerfile、YAML、JSON、TOML、XML、Markdown 等。语言识别主要基于文件扩展名，对模糊文件回退到 shebang 行和内容检测；默认跳过生成目录，因此统计反映的是人工编写的源码。

### 可以导出 SLOC 结果吗？

可以。OctoCounts 支持三种导出格式，位于分析结果下方的操作按钮中。纯文本将格式化表格复制到剪贴板，按列对齐显示语言、文件数、总行数、代码行、注释行和空白行，适合粘贴到 README、GitHub Issue 或文档中。JSON 下载完整的结构化报告，包含按语言统计和汇总数据，便于脚本和 CI 管道消费。PNG 下载 1200 × 630 的图片卡片，展示语言细分，适用于社交媒体、GitHub README 或作品集页面。三种格式均在浏览器端从已加载的数据生成，不需要额外请求。

### 如何在 README 中添加 SLOC 徽章？

使用徽章构建器（/badges）选择徽章类型，复制生成的 Markdown 片段，粘贴到 README.md 中。徽章支持总 SLOC、代码行、文件数、注释行、语言数、最高语言、代码占比和单语言计数。每个徽章渲染该仓库最新的已缓存报告，并链接回实时报告页面，读者可点击查看原始数字。

### 可以比较两个仓库吗？

可以。/compare 页面并排比较任意两个公开 GitHub 仓库、分支、标签或提交，显示双方的文件数、总行数、代码行、注释、空白和按语言统计。/diff 页面比较同一仓库的两个 ref，便于查看重构或依赖升级对代码规模的影响。OctoCounts 还发布了 React vs Vue 和 Rust vs Go 等精选比较页面，附有编辑上下文。

## 方法与准确性

### OctoCounts 如何统计代码行数？

OctoCounts 将所选分支、标签或提交 SHA 解析为确定的提交，下载该 ref 的 GitHub 源码归档（压缩 tarball，不是完整的 git clone），解压后用 tokei 统计源码。依赖、构建、文档、测试和生成目录（如 .git、node_modules、target、docs、tests、generated）默认排除，避免这些目录里的代码、测试和文档灌高统计；排除按目录名进行，其他目录的同类文件仍会计入。完整规则见计数方法说明（中文）。

### 与 GitHub 语言条有何不同？

OctoCounts 报告绝对计数而非百分比。GitHub 语言条显示每种语言的字节占比，不显示文件数或行数，且 Linguist 默认排除它识别为生成、vendored 或文档的文件（可被仓库覆盖）。OctoCounts 报告实际数字——文件、总行数、代码行、注释行、空白行和按语言汇总——固定在特定提交上，默认排除依赖、构建、文档、测试和生成目录。结果可被审查者复现：同一提交、同一引擎版本、同一实际规则。OctoCounts 还为每个分析生成可分享的链接和引用块，而 GitHub 语言条没有固定链接。详见 GitHub 语言条替代页（英文）。

### 与本地运行 tokei 或 cloc 有何不同？

OctoCounts 下载压缩归档而非完整克隆，无需本地安装，按提交 SHA 缓存报告，提供可分享的报告链接、README 徽章、API、CLI 和 GitHub Action。如需分析私有仓库或自定义分析，本地运行 tokei 或 cloc 仍是最佳选择。详见 OctoCounts vs cloc 和 tokei（英文）。

### 什么是缓存报告？

缓存报告是按仓库提供方、所有者、仓库名、提交 SHA、tokei 版本和分析选项键控的已保存 SLOC 结果。在报告仍缓存期间，相同的提交、引擎版本和生效规则可以复用已保存结果，无需重新下载或重新计数。

### OctoCounts 的报告准确吗？

报告对下载的源码归档和所选分析选项是精确的。它反映单个提交的公开归档，而非完整的 git 历史或已排除的文件。依赖、构建、文档、测试和生成目录默认排除，调用方可以选择重新包含。不同提交、引擎版本或过滤规则的结果可能不同，比较和引用时必须说明这些条件。

## 隐私、API 与项目

### 支持私有仓库吗？

不支持。OctoCounts 只分析公开 GitHub 仓库。分析不需要 GitHub 账号访问，不支持私有仓库，也不接受源码上传。如需统计私有仓库的代码行数，请在本地运行 tokei：下载 tokei，clone 你的仓库，在仓库根目录运行 tokei。tokei 免费开源，报告代码、注释和空白行；OctoCounts 在此基础上提供自己的报告字段和导出功能。

### OctoCounts 会保存我的源码吗？

不会。OctoCounts 只分析公开仓库，存储的仅是按提交 SHA 和分析选项键控的聚合统计——文件数、代码/注释/空白拆分的行数和按语言汇总。下载的归档中的源码文件不会被持久保存，无需注册，也没有要上传的内容。详见隐私政策（英文）。

### 有 API 或 CLI 吗？

有。OctoCounts API 是公开的 HTTP 接口，用于不克隆公开 GitHub 仓库就能统计代码行数；端点覆盖发起 SLOC 分析、获取缓存报告、检查单个分析任务和生成 README 徽章。网页的 compare 和 diff URL 格式也记录在 API 文档（英文）中。除了 API，OctoCounts 还提供 CLI（通过 npm 的 npx octocounts 运行）、MCP server（让 AI 助手在对话中获取 SLOC 数据）和 GitHub Action（在 pull request 上评论规模变化）。全部无需注册或登录。

### 可以在 CI 或 GitHub Actions 中使用吗？

可以。OctoCounts GitHub Action 在 pull request 上运行，评论变化对代码行数的影响，让审查者看到相对 diff 的规模变化。CLI（npx octocounts）可在任何终端或 CI 脚本中运行，输出可供管道消费的 JSON，用于报告或自定义检查。

### 仓库过大时会怎样？

非常大的仓库可能超过分析器的归档大小或时间限制，此时分析会以清晰的错误失败，而不是返回部分数字。可行方案：稍后重试；分析同一仓库的较小分支或标签；或在本地运行 tokei（没有下载限制）。先前成功的报告在缓存期内仍可能可用，但受保留和大小限制约束。

### 如何引用一份 OctoCounts 报告？

固定的计数应引用包含 reportId 的已保存报告链接，并附上完整提交 SHA、测量日期、tokei 版本和生效的统计规则（countingPolicy）。为长期保留导出报告 JSON 或文本：已保存的报告仍受缓存清理和替换影响。规范的仓库和 ref 链接跟随实时缓存报告，可能变化。每个报告页都会包含推荐的引用块；在已保存的报告路径后附加 .md 同时保留 reportId 查询参数，可获取同一已保存结果的 Markdown 版本。

### 谁维护 OctoCounts？

OctoCounts 由 huanglizhuo 构建和维护，他还编写了浏览器扩展和 Rust 后端。项目在 GitHub 上以 MIT 许可证开源，接受 issue 和 pull request，并公开记录计数方法。更多背景和联系信息见关于页面（英文）。

## 相关资源

- [中文 SLOC 使用指南](https://octocounts.com/zh/docs/github-sloc-counter)
- [中文计数方法与引用规则](https://octocounts.com/zh/docs/methodology)
- [中文首页](https://octocounts.com/zh)
- [English FAQ](https://octocounts.com/docs/faq)
- [项目源码](https://github.com/huanglizhuo/OctoCounts)
