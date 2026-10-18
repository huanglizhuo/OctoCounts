# GitHub 代码行数统计：OctoCounts SLOC 使用指南

更新于 2026-10-18 · 维护者：[huanglizhuo](https://github.com/huanglizhuo)

OctoCounts 是免费的公开 GitHub 仓库代码行数统计工具。粘贴仓库链接即可按语言查看文件数、代码行、注释行和空白行，无需在本地克隆仓库。服务端下载指定提交的源码归档，再使用开源统计引擎 [tokei](https://github.com/XAMPPRocky/tokei) 计数。

规范页面：https://octocounts.com/zh/docs/github-sloc-counter

[开始统计代码行数](https://octocounts.com/zh) · [English version](https://octocounts.com/docs/github-sloc-counter) · [Markdown 版本](https://octocounts.com/zh/docs/github-sloc-counter.md)

## SLOC 是什么？

SLOC 是 Source Lines of Code，即源代码行数。OctoCounts 将代码行、注释行和空白行分开显示；总行数是这三项之和。SLOC 可以帮助了解项目规模和语言构成，但不能单独衡量代码质量、开发效率或工作量。比较两个数字前，应先检查提交 SHA、统计引擎版本及实际生效的过滤规则。

## 如何统计 GitHub 仓库代码行数？

1. 打开 [OctoCounts 中文首页](https://octocounts.com/zh)，输入公开 GitHub 仓库地址，例如 `https://github.com/facebook/react`。
2. 选择分支、标签或提交 SHA；留空时使用仓库默认分支。需要精确引用某个版本时，优先使用提交 SHA。
3. 根据目的设置文档、测试、生成目录、排除目录和忽略语言等选项。仅源码模式会强制排除文档、测试和生成目录。
4. 发起分析，查看按语言排列的代码行数及报告中的实际统计规则。
5. 使用固定分享链接引用已保存的结果，并导出 JSON 或文本留档；也可以导出 PNG 图片展示结果。

在线服务只支持公开 GitHub 仓库，不支持私有仓库，也不接受源码上传。私有项目可在本地运行 tokei。服务端仍需下载源码归档，因此“无需克隆”不表示分析不需要网络传输。

## 结果应该怎么看？

例如，一份示意报告显示 1,000 行代码、200 行注释和 100 行空白，总行数就是 1,300 行。这里的数字仅用于解释指标，不是某个真实仓库的测量值。比较项目规模时，应说明引用的是代码行还是总行数，以及测试、文档和生成目录是否被排除。

GitHub 语言条主要体现语言的字节占比，不能直接当作代码行数。OctoCounts 使用 tokei 的语言识别和行分类规则；同一语言的字节占比与代码行占比可能不同。详见 [GitHub 语言条与代码行统计的区别（英文）](https://octocounts.com/docs/github-language-bar-alternative)。

## 统计流程与准确性

OctoCounts 校验公开仓库地址，将所选 ref 解析为提交 SHA，下载该提交的源码归档，在临时目录解压后应用过滤规则，再由 tokei 统计。缓存键包含仓库、提交 SHA、tokei 版本和分析选项。同一个分支或标签以后可能指向不同提交，不能仅凭 ref 名称认为数值固定。

报告描述的是下载到的源码树在指定规则下的统计结果。默认会跳过 `node_modules`、`vendor`、`target`、`build`、`dist` 等目录，但这不代表所有自动生成文件都已被识别。语言分类、忽略文件和过滤选项都会影响结果。详细规则见 [中文计数方法说明](https://octocounts.com/zh/docs/methodology)。

## 在线使用 tokei

OctoCounts 为 tokei 提供在线入口，适合无需安装命令行工具就查看公开仓库。它不是所有本地 tokei 参数的通用替代品。若需分析私有代码、完整控制文件范围或保留离线结果，可在本地运行 tokei，并记录引擎版本和参数。两种方式的结果只有在输入源码和生效规则一致时才适合直接比较。

## 比较两个仓库或两个版本

- [仓库比较工具](https://octocounts.com/compare)：并排查看两个公开仓库的语言分布和规模；先检查双方规则是否兼容。
- [版本差异工具](https://octocounts.com/diff)：比较同一仓库两个分支、标签或提交的统计值，差值为 head 减去 base。
- 差值表示源码树规模的净变化，不是 Git diff 的新增行与删除行。基数为零且新值大于零时，界面显示新增，而不是无穷大的百分比。
- 固定比较链接会引用双方已保存的报告。缺少统计规则的旧报告应视为兼容性未知，不能直接宣布可比。

## 徽章、API 与导出

[徽章工具](https://octocounts.com/badges) 可生成用于 README 的代码行数、文件数等徽章。固定模式引用已保存的报告，实时模式跟随所选 ref 更新；不同展示入口的缓存刷新时间可能不同。

脚本集成可使用 `POST /api/analyze` 发起任务，轮询任务状态，再读取 `/api/reports/{reportId}`。请按服务端返回的任务和报告标识继续请求，处理失败、限流和过期结果。请求字段及响应格式以 [API 文档（英文）](https://octocounts.com/docs/api) 为准。

页面可导出 JSON、文本和 PNG。需要长期引用统计数据时，应保留 JSON 或文本，同时记录提交 SHA、引擎版本、生成时间和 countingPolicy；PNG 适合展示，但不应代替完整数据留档。

## 如何引用一份报告？

引用时写清“截至某日期，某仓库在某提交和某规则下有多少代码行、注释行、空白行及文件”。优先附上带 `reportId` 的固定报告链接，并保留导出副本。普通仓库地址跟随公开缓存报告；分支、标签和实时结果可能变化。已保存报告也受缓存清理或替换影响，固定链接不等于永久存档。

## 常见问题

### OctoCounts 可以免费使用吗？

可以。公开 GitHub 仓库的网页分析无需注册或 API 密钥。服务仍受仓库可用性、大小限制和请求限流影响；免费不代表所有仓库都能成功分析。

### 可以统计私有 GitHub 仓库吗？

在线服务只支持公开 GitHub 仓库，不请求私有仓库访问权限，也不接受源码上传。私有项目应在自己的环境中运行 tokei。

### 是否需要先 git clone？

不需要在本地克隆。OctoCounts 服务端下载指定提交的源码归档，不下载完整 Git 历史，然后应用过滤规则并运行 tokei。

### 为什么与其他代码行统计工具的结果不同？

不同工具可能使用不同的语言解析器、忽略规则和文件范围。比较之前需要统一提交、引擎版本、目录排除、忽略语言和生成文件处理方式；仅有相同仓库名称不足以保证可比。

### 报告链接能永久保持同一个数值吗？

带 reportId 的固定链接读取已保存的结果，但该结果仍可能因缓存清理或替换而失效，失效时不会静默重算。长期引用请同时保留导出的 JSON 或文本。实时链接会随 ref 和公开缓存更新而变化。

## 继续阅读

- [中文计数方法：过滤规则、复现与引用](https://octocounts.com/zh/docs/methodology)
- [统计工具对比（英文）](https://octocounts.com/docs/best-sloc-counter-tools)
- [tokei、cloc 与 scc 的区别（英文）](https://octocounts.com/docs/tokei-vs-cloc-vs-scc)
- [代码行数与仓库体积（英文）](https://octocounts.com/docs/github-repository-size-checker)
- [过滤规则对结果的试点研究（英文）](https://octocounts.com/research)
- [完整英文指南及专题文档索引](https://octocounts.com/docs/github-sloc-counter)
