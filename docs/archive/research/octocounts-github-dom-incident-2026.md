# OctoCounts GitHub DOM 兼容事故：资料与证据时间线（2026-07—08）

> 调研日期：2026-08-09。本文是写作底稿，不是最终文章。时间同时给出 UTC 和新加坡时间（SGT, UTC+8）。“已确认”只使用项目仓库、GitHub Release 和 Chrome 官方文档；没有一手证据的部分明确标为推断。

## 结论摘要

1. **故障机制已由代码历史直接确认。** 0.4.2 之前，OctoCounts 把 `.BorderGrid` 同时当作“这是仓库页”的判据和卡片插入点。GitHub 仓库侧栏换成 CSS Modules 后，实际容器变为 `CodeViewSidebar-module__borderGrid__<hash>`，旧选择器找不到节点，扩展因此既可能判定“不是仓库页”，也无法插入卡片。[修复前 `detect.js`](https://github.com/huanglizhuo/OctoCounts/blob/7b2f95a219d178740afe8f717017f7e3c8af1a70/extension/src/content/detect.js#L1-L15)；[修复前 `card.js`](https://github.com/huanglizhuo/OctoCounts/blob/7b2f95a219d178740afe8f717017f7e3c8af1a70/extension/src/content/card.js#L24-L73)；[修复提交](https://github.com/huanglizhuo/OctoCounts/commit/93d20322f1e2b4ec794ece59d620fa705e97693d)。
2. **0.4.2 的修复时间可精确到 2026-08-05 02:26—02:27 SGT。** 修复提交时间为 2026-08-04 18:26:55 UTC（02:26:55 SGT）；版本提交与 tag 紧随其后；GitHub Release 于 18:27:31 UTC 发布，并明确写着 “Fix/extension card insertion failed due to github css class name change”。[0.4.2 Release](https://github.com/huanglizhuo/OctoCounts/releases/tag/extension-v0.4.2)。
3. **截图不是 DAU（活跃使用）证据。** Chrome 官方明确说明 Users 统计“只捕获安装，不监测用户是否活跃”。因此文章不应写“DAU 从 900 跌到 30”，而应写“Chrome Web Store Users 图中，按版本统计的安装数从约 900–1,000 降至约 30”。[Chrome Web Store metrics](https://developer.chrome.com/docs/webstore/metrics#users)。
4. **GitHub 分阶段发布是合理假说，但目前没有一手证据。** 用户曲线的分段下降与逐步 rollout 相容；然而截至调研日，没有找到 GitHub Changelog、官方 Discussion 回复或状态页记录，能够证明这次 `BorderGrid` → CSS Modules 迁移的起止时间、百分比或在 8 月 5 日完成。文章必须将其写成推断，不能写成事实。
5. **曲线与 CSS 故障之间不能直接画等号。** CSS/DOM 改动能解释“卡片消失”，却不会直接让 Chrome Web Store 的安装记录消失；安装数下跌还需要卸载、统计口径/上报、设备回报或其他因素。截图本身只能支持相关性，不能证明因果。

## 精确时间线

| 时间 | 已确认事件 | 证据与解释 |
|---|---|---|
| 2026-06-15 14:41:52 UTC / 22:41:52 SGT | `extension-v0.4.0` GitHub Release 发布 | [Release](https://github.com/huanglizhuo/OctoCounts/releases/tag/extension-v0.4.0)。仓库 tag 中 `extension/package.json` 为 `0.4.0`。 |
| 2026-07-04 13:45:36 UTC / 21:45:36 SGT | `extension-v0.4.1` GitHub Release 发布 | [Release](https://github.com/huanglizhuo/OctoCounts/releases/tag/extension-v0.4.1)。该版本仍使用 `.BorderGrid` 门控和插入逻辑。 |
| 2026-07-09—07-15 | 截图中的 Users 总量约为 900–1,000/日 | 来自用户提供的 Chrome Web Store Developer Dashboard 截图；数值为读图近似值，不应伪装成 CSV 精确数据。 |
| 约 2026-07-16 | 截图第一次出现明显台阶，约从 1,000 降至 650，随后到约 450–520 区间 | **观察事实（截图）**。这与 GitHub 开始扩大新 DOM 覆盖面相容，但不能仅凭该图确认 rollout 起点。 |
| 2026-07-17—08-03 | 图中大部分日期维持约 430–550，旧版本仍占绝大多数 | **观察事实（截图）**。旧版本仍被统计，说明版本更新并没有立即覆盖所有安装。 |
| 2026-08-04 左右 | 图中总量再次降至约 250 | **观察事实（截图）**；具体日期应从 Dashboard 导出 CSV 后复核。 |
| 2026-08-04 18:26:55 UTC / 2026-08-05 02:26:55 SGT | 提交 `93d2032`，修复 GitHub DOM 兼容性 | [提交及完整说明](https://github.com/huanglizhuo/OctoCounts/commit/93d20322f1e2b4ec794ece59d620fa705e97693d)。提交记录明确列出 `.BorderGrid` 依赖破坏的页面检测、挂载点、observer、Languages 区域和 popup 状态。 |
| 2026-08-04 18:27:00 UTC / 02:27:00 SGT | 提交 `cb8dc72` 将版本升至 `0.4.2`，tag `extension-v0.4.2` 指向该提交 | [版本提交](https://github.com/huanglizhuo/OctoCounts/commit/cb8dc72a15f951b50cf094b13ddac33fae1ec7b7)。 |
| 2026-08-04 18:27:31 UTC / 02:27:31 SGT | GitHub Release `extension-v0.4.2` 发布，包含 Chrome/Edge/Firefox 构建包 | [0.4.2 Release](https://github.com/huanglizhuo/OctoCounts/releases/tag/extension-v0.4.2)。注意：这是 GitHub Release 的时间，**不是** Chrome Web Store 审核通过或开始分发的时间。 |
| 2026-08-05（无公开精确时刻） | Chrome Web Store 当前商品页把 `0.4.2` 标为此日更新 | [Chrome Web Store 商品页](https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj)。这能确认商店记录的更新日期，但仍不能还原 submitted、approved、published 或各客户端实际安装更新的精确时刻。 |
| 2026-08-05 | 项目保存了一份从 live github.com 捕获的仓库页 DOM | fixture 显示侧栏类为 `CodeViewSidebar-module__borderGrid__HASH`，且首屏 SSR 时侧栏标题已出现、内部链接尚未 hydration。[live capture](https://github.com/huanglizhuo/OctoCounts/blob/93d20322f1e2b4ec794ece59d620fa705e97693d/extension/tests/fixtures/github-sidebar-live-capture.html)；[fixture 说明](https://github.com/huanglizhuo/OctoCounts/blob/93d20322f1e2b4ec794ece59d620fa705e97693d/extension/tests/fixtures/README.md)。 |
| 2026-08-05—08-07 | 截图中只剩约 30–40 的深色 `0.4.2` 安装记录 | **观察事实（截图）**。不能据此断言 GitHub rollout 恰在 8 月 5 日 100% 完成；也不能称这 30 人为“0.4.2 的 DAU”。 |

## 代码层面的事故链

### 修复前：一个样式类承担了三个业务职责

- 页面识别：`isPublicRepoRoot()` 在 URL 之外硬性要求 `document.querySelector('.BorderGrid')`，找不到就返回 false。[旧 `detect.js`](https://github.com/huanglizhuo/OctoCounts/blob/7b2f95a219d178740afe8f717017f7e3c8af1a70/extension/src/content/detect.js#L1-L15)
- 卡片挂载：`findBorderGrid()` 的四个候选选择器全部以 `.BorderGrid` 为核心；最多重试 5 次后放弃。[旧 `card.js`](https://github.com/huanglizhuo/OctoCounts/blob/7b2f95a219d178740afe8f717017f7e3c8af1a70/extension/src/content/card.js#L24-L73)
- popup 状态和重挂载守卫：content entry 再次使用 `.BorderGrid` 判断仓库页，并让 observer 监听该节点。[旧 `index.js`](https://github.com/huanglizhuo/OctoCounts/blob/7b2f95a219d178740afe8f717017f7e3c8af1a70/extension/src/content/index.js#L66-L75)；[popup 状态判断](https://github.com/huanglizhuo/OctoCounts/blob/7b2f95a219d178740afe8f717017f7e3c8af1a70/extension/src/content/index.js#L130-L139)

这使一个本应只负责视觉表现的外部 CSS 类，变成页面类型、组件定位和运行状态的共同“API”。GitHub 一次类名/组件实现迁移便让所有路径同时失效。

### GitHub 页面已变成什么

2026-08-05 的项目内实页捕获显示：

- 外层布局使用 `Layout-module__...__<hash>`；
- 侧栏使用 `CodeViewSidebar-module__borderGrid__<hash>`；
- 各区块使用 `SidebarSection-module__sidebarSection__<hash>`；
- 首次挂载时标题（About、Releases、Contributors、Languages）已由服务端渲染，但部分链接仍是 skeleton，待客户端 hydration。

这是项目在故障当日保存的第一手页面样本，而不是 GitHub 对 rollout 的官方公告。[fixture](https://github.com/huanglizhuo/OctoCounts/blob/93d20322f1e2b4ec794ece59d620fa705e97693d/extension/tests/fixtures/github-sidebar-live-capture.html)。

### 0.4.2 如何修复

`93d2032` 新增单一 GitHub DOM adapter，优先使用结构/语义，再把类名当作 fallback：

1. 从仓库专属链接推断最小共同祖先；
2. 识别“至少两个带 heading 的同级 section”，完全不依赖 class；
3. fallback 到 CSS Modules 的稳定 part name：`[class*="-module__borderGrid"]`，不依赖 hash；
4. 最后兼容 legacy `.BorderGrid`、ARIA/aside/layout 和 Languages 相邻结构；
5. 每个候选都经过验证，拒绝包含 README 或文件表的主栏，避免把卡片插错位置。

实现见 [`github-dom.js`](https://github.com/huanglizhuo/OctoCounts/blob/93d20322f1e2b4ec794ece59d620fa705e97693d/extension/src/content/github-dom.js)，测试见 [`github-dom.test.mjs`](https://github.com/huanglizhuo/OctoCounts/blob/93d20322f1e2b4ec794ece59d620fa705e97693d/extension/tests/github-dom.test.mjs)。测试会随机替换 CSS Module hash，避免“修好一个 hash、下次构建再次坏掉”。

该提交还增加了：

- 每 6 小时在真实 GitHub 页面加载 Chromium 扩展的 scheduled smoke test；失败时保存 screenshot、trace、DOM fingerprint，并可开 issue。[workflow](https://github.com/huanglizhuo/OctoCounts/blob/93d20322f1e2b4ec794ece59d620fa705e97693d/.github/workflows/extension-dom-monitor.yml)
- popup 的 9 种 mount state、真正挂载失败时的报告入口和去重 fingerprint；
- 更稳健的 private/fork 检测（React embedded payload 和 octolytics meta 优先）；
- API error 渲染、重复卡片清理、无效 observer/interval 等伴随问题的修复。

## 应如何解读 Chrome Web Store 截图

### 可以确认

- 图表名称是 “Daily users by item version”，时间范围为 2026-07-09 至 2026-08-07；legend 包含 `0.1.6.0`、`0.1.9.0`、`0.3.1.0`、`0.4.0.0`、`0.4.1.0`、`0.4.2.0`。
- 7 月上旬总数约 900–1,000，7 月 16 日附近出现明显下台阶，8 月 5 日后约 30–40 且主要/仅显示 0.4.2。
- Chrome 官方把 Users 统计定义为安装统计，并明确说它不判断用户是否活跃。[官方指标定义](https://developer.chrome.com/docs/webstore/metrics#users)

### 不可以从截图确认

- 不能确认 900 人每天都使用了扩展，或 30 人每天使用了 0.4.2；因此不是产品意义上的 DAU。
- 不能确认 900 → 30 全由 GitHub CSS 改动造成。DOM 故障解释功能失效，但安装数减少仍需用户卸载或其他统计/上报机制。
- 不能确认 GitHub 在 7 月 16 日开始 rollout、8 月 5 日完成 rollout。曲线形状只能形成假说。
- 不能确认 0.4.2 在 GitHub Release 后何时通过 Chrome Web Store review、何时实际开始向用户分发。Chrome 官方说明，更新必须上传更高版本、提交审核，只有发布后才影响现有用户。[更新流程](https://developer.chrome.com/docs/webstore/update/)

### 更新传播为什么不会瞬间完成

Chrome 默认会在启动时及每隔数小时检查扩展更新，但只有扩展处于 idle 时才安装；打开的 popup、options 或 side panel 会延迟更新，持续活跃的 service worker 也可能延迟到浏览器重启。[Chrome Extension update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle)

OctoCounts 图中约 900–1,000 安装，低于 Chrome Web Store “超过 10,000 七日活跃用户”才能使用的 partial rollout 门槛。因此，**0.4.2 自身不应被描述为开发者通过 CWS 百分比 staged rollout**；但普通自动更新仍会因检查周期和 idle 条件逐步传播。[partial rollout 官方限制](https://developer.chrome.com/docs/webstore/update/#set-partial-rollout-percentage)。这与“GitHub 是否 staged rollout”是两个完全不同的问题。

## GitHub phased rollout 假说：证据分级

### 支持它的间接证据

- 用户图不是一次性从约 1,000 变为约 30，而是先在 7 月中旬降至约 500，再在 8 月初降至约 250 和约 30，形状像分批暴露。
- 0.4.1 代码对 `.BorderGrid` 的依赖是确定的；8 月 5 日 live capture 已确定 GitHub 页面使用 CSS Modules。
- 0.4.2 修复提交和 Release 都直接把事故归因于 GitHub CSS class/DOM 改动。

### 反证/缺口

- 没有 GitHub 第一方材料说明此次迁移使用 percentage rollout，更没有 7 月 16 日和 8 月 5 日两个里程碑。
- Chrome Users 图衡量安装而非扩展在 GitHub 页面上的成功挂载；它不是 GitHub 新 DOM 覆盖率的直接探针。
- 如果旧版本只是“坏了但仍安装”，它们理论上仍应留在安装统计里。旧版本条带消失需要额外解释（卸载、上报/统计状态或别的因素）。
- 图中有缺日/异常日的视觉迹象，且没有 CSV 原始值，不能做精确回归或断点分析。

### 文章中推荐措辞

可写：

> 从 7 月中旬开始，Chrome Web Store 的按版本安装图出现阶梯式下滑；与此同时，旧版扩展依赖的 `.BorderGrid` 在 GitHub 新仓库侧栏中被 CSS Modules 容器替代。曲线与分阶段前端发布的形状相符，但 GitHub 没有公开此次迁移的 rollout 时间表，所以这仍是基于时间相关性的推断，而非官方确认。

不建议写：

> GitHub 从 7 月 16 日开始灰度，8 月 5 日 100% 发布完成，导致 DAU 从 900 降到 30。

## 写文章前应补齐的原始材料

1. 从 CWS Dashboard 导出 Users CSV，保留每日、版本的精确数值；用它代替截图目测。
2. 记录 0.4.2 在 Chrome Web Store Dashboard 的 submitted / approved / published 时间；不要用 GitHub Release 时间替代商店上线时间。
3. 若后端有匿名请求量、成功分析数、独立安装遥测或 popup/card 事件，对照同一时段。只有产品端事件才更接近 DAU/功能使用。
4. 搜索并保存事故期的用户 review、issue、邮件或支持反馈，尤其是首次“卡片消失”报告的时间。
5. 如能取得不同账户/地区在 7 月中下旬的 GitHub HTML 或截图，可验证是否同时存在 legacy `.BorderGrid` 和新 CSS Modules DOM，从而加强 phased rollout 假说。

## 可直接用于文章的叙事骨架

1. **事故表象**：一个没有报错的扩展，用户看到的只是卡片悄悄消失；安装图在一个月内断崖下跌。
2. **为什么难发现**：扩展把第三方页面的 CSS 类当成了稳定 API，而且页面识别、挂载和健康状态共享同一个脆弱依赖。
3. **证据回放**：旧代码的 `.BorderGrid` gate、8 月 5 日 live DOM capture、修复 commit、版本发布依次对上。
4. **修复不是换一个 selector**：使用语义/结构 resolution ladder、错误候选验证、hash 随机测试。
5. **监测体系补课**：真实页面行为 smoke test、DOM fingerprint、用户自助 diagnostics；监测“卡片是否出现”而不是“某个 class 是否存在”。
6. **数据诚实**：把 CWS Users 称为安装数而非 DAU，把 GitHub phased rollout 明确标为推断。
7. **长期教训**：第三方 DOM 永远不是正式 API；无法避免耦合时，应集中到 adapter、准备多层 fallback、保存真实 fixture，并监测最终行为。

## 一手来源索引

- [OctoCounts 修复提交 `93d2032`](https://github.com/huanglizhuo/OctoCounts/commit/93d20322f1e2b4ec794ece59d620fa705e97693d)
- [OctoCounts Extension v0.4.2 Release](https://github.com/huanglizhuo/OctoCounts/releases/tag/extension-v0.4.2)
- [OctoCounts 0.4.2 Chrome Web Store 商品页](https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj)
- [修复前 `detect.js`](https://github.com/huanglizhuo/OctoCounts/blob/7b2f95a219d178740afe8f717017f7e3c8af1a70/extension/src/content/detect.js)
- [修复前 `card.js`](https://github.com/huanglizhuo/OctoCounts/blob/7b2f95a219d178740afe8f717017f7e3c8af1a70/extension/src/content/card.js)
- [2026-08-05 GitHub live DOM fixture](https://github.com/huanglizhuo/OctoCounts/blob/93d20322f1e2b4ec794ece59d620fa705e97693d/extension/tests/fixtures/github-sidebar-live-capture.html)
- [Chrome：Analyze your store listing metrics](https://developer.chrome.com/docs/webstore/metrics)
- [Chrome：The Chrome Extension update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle)
- [Chrome：Update your Chrome Web Store item](https://developer.chrome.com/docs/webstore/update/)
