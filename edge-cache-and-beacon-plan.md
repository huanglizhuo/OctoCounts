# OctoCounts 边缘缓存与 Beacon 方案（P3）——「待应用」变更说明书

> **状态：待应用（not applied）。** 编写 agent 没有 Cloudflare 控制台权限，本文只是一份可复核的外部配置变更规格与验证清单。**截至今日没有任何一项变更被应用到线上**；线上仍是"部分路径已缓存、首页/工具页 DYNAMIC"的现状。应用与验收需要你（或有控制台权限的人）按本文步骤操作。
>
> 实测时间：2026-09-26 16:44–16:53 UTC（北京时间 2026-09-27 00:44–00:53），观测点 SIN（新加坡）边缘节点，仓库 HEAD `de2b47c`。全部测量为只读 HTTP GET；原始证据文件在 `/tmp/p3-*`（清单见附录 B）。
>
> 标注约定：**[实测]** = 本文日期的线上测量；**[代码]** = 仓库源码事实（`frontend/functions/[[path]].js`，HEAD `de2b47c`）；**[文档]** = Cloudflare 官方文档（附录 C）；**[推断]** = 由前三者推出的结论，明确标注不确定度。

---

## 1. 现状与证据

### 1.1 本次实测摘要（[实测]）

| URL | 请求次数 | cf-cache-status | TTFB | cache-control | 说明 |
| --- | --- | --- | --- | --- | --- |
| `/` | 3 | 3× `DYNAMIC` | 282 / 679 / 278 ms | `public, s-maxage=300, stale-while-revalidate=600` | 计划文档 2026-09-26 早些时候的 307/356/351 ms 基线一致：完全未进边缘缓存 |
| `/compare` | 2 | 2× `DYNAMIC` | 260 / 262 ms | 同上 | |
| `/diff` | 1 | `DYNAMIC` | 244 ms | 同上 | 与 `/compare` 同一 handler [代码 L173] |
| `/compare/react-vs-vue`（curated） | 2 | 2× `DYNAMIC` | 1441 / 325 ms | 同上 | 第二次变快是 Function 热身，不是缓存；首次 1.4s 是最值得拿下的 TTFB |
| `/badges` | 1 | `DYNAMIC` | 232 ms | 同上 | |
| `/extension` | 2 | 2× `DYNAMIC` | 151 / 218 ms | 同上 | |
| `/embed/github/facebook/react` | 1 | `DYNAMIC` | 524 ms | 同上 | |
| `/trending.xml` | 1 | `DYNAMIC` | 268 ms | `public, s-maxage=3600, stale-while-revalidate=86400` | RSS feed，同样未缓存 |
| `/docs/methodology` | 1 | `DYNAMIC` | 205–761 ms | `public, max-age=3600` | 静态资产（`_headers`），无 s-maxage |
| `/research` | 1 | `DYNAMIC` | 247 ms | `public, max-age=0, must-revalidate` | 静态资产，origin 明确要求每次校验 |
| `/stats` | 3 | `MISS` → `HIT`(age 28) → `HIT`(age 26) | 7462（冷）→ 293 → 227 ms | 300/600 + `last-modified` | **已经在边缘缓存**，首次 MISS 冷启动 7.5s 说明回源成本高 |
| `/recent` | 2 | `MISS` → `EXPIRED` | 1434 / 1061 ms | 300/600 + `last-modified` | 已缓存 |
| `/popular` | 2 | `MISS` → `EXPIRED` | 1194 / 1273 ms | 同上 | 已缓存 |
| `/trending` | 2 | 2× `EXPIRED` | 399 / 252 ms | 同上 | 已缓存（EXPIRED = 过期后 serve-stale 并回源刷新，SWR 在边缘生效） |
| `/hall-of-monoliths` | 2 | 2× `MISS` | 1393 / 1881 ms | 同上 | 已缓存 |
| `/github/facebook/react` | 2 | `HIT`(age 2) → `REVALIDATED` | 257 / 263 ms | 300/600 + `last-modified` | 已缓存且支持 304 条件请求再验证 |
| `/github/facebook/react.md` | 1 | `MISS` | 1073 ms | `public, s-maxage=3600, stale-while-revalidate=86400` | markdown 孪生页是独立缓存条目 |
| `/github/facebook/react?format=md` | 1 | `MISS` | 240 ms | 同上 | 查询串变体也是独立条目（同分钟内 HTML 为 HIT、`?format=md` 为 MISS，证明查询串参与 cache key） |
| `/sitemap.xml` | 1 | `EXPIRED` | 3299 ms | 3600/86400 | 已缓存 |
| `api.octocounts.com/api/stats` | 2 | 2× `HIT`（age 35/37） | 195 / 161 ms | `public, max-age=60, s-maxage=60, stale-while-revalidate=300` | API 域名自身已有缓存，与本方案无关 |
| `/github/<不存在的仓库>` | 1 | `MISS` | 1174 ms | `public, max-age=60` | [代码 L298 附近] 未分析仓库的 200 noindex 占位页，属既有 `/github/*` 缓存范围 |

结论：**边缘缓存是"半覆盖"状态**。`/github/*`（含 `.md` 与 `?format=md` 变体）、`/stats`、`/recent`、`/popular`、`/trending`、`/hall-of-monoliths`、`/sitemap.xml` 已被缓存；而 `/`、`/compare`、`/diff`、`/compare/<slug>`、`/badges`、`/extension`、`/embed/*`、`/trending.xml`、`/docs/*`、`/research` 全部 `DYNAMIC`。

### 1.2 为什么一半页面能缓存、另一半不能（[代码] + [文档] + [推断]）

1. **[文档]** Cloudflare 默认只按文件扩展名缓存，"CDN 默认不缓存 HTML/JSON"。无扩展名的 `/`、`/compare` 等按默认行为永远是 `DYNAMIC`，无论 origin 发什么 `cache-control`。
2. **[代码]** `frontend/functions/[[path]].js` L2222–2228 的注释明确写着：*"the zone cache rule in front of this function keys purely on URL"* —— 仓库作者已知**该 Cloudflare zone 上已存在一条（或一组）Cache Rule**，cache key 只按 URL，不含 User-Agent。
3. **[实测] + [推断]** 已缓存/未缓存页面的响应头几乎一致（同样的 300/600、同样的 `vary: accept-encoding`），唯一系统性差别是已缓存集合恰好是"报告 + 列表 + stats + sitemap"，未缓存集合是首页/工具页/embed/feed。**推断：现有 Cache Rule 的匹配表达式只覆盖了前一组路径。** 具体表达式是什么，编写 agent 无控制台权限、无法读出 —— 所以第 3 节第 0 步要求先导出现有规则。
4. **[实测]** 该现有规则的行为已被本次测量锚定：尊重 origin `s-maxage`（300s 后 `EXPIRED`）、支持 Last-Modified 再验证（`REVALIDATED`）、`.md` 与 `?format=md` 作为独立 URL 各自成条目。

### 1.3 必须保留的代码事实（[代码]，HEAD `de2b47c`）

| 事实 | 位置 |
| --- | --- |
| 首页/工具页 HTML 统一 `public, s-maxage=300, stale-while-revalidate=600` | `homePageResponse`（L1091）、compare/badges/extension/embed/curated-compare 等（L506、L774、L812、L833、L912、L1033、L1206–1208） |
| 报告 HTML 300/600 + `last-modified`（报告数据时间）+ 304 条件 GET | L355–363 |
| markdown 孪生（`.md` / `?format=md`）`s-maxage=3600, swr=86400` | L347、L559、L631、L705、L962、L1206 |
| **仅凭 UA 产生的 markdown（AI 检索 bot）强制 `private, no-store` + `Vary: User-Agent`**，注释解释原因正是"URL-only 的 zone cache rule 会把 UA 变体和 HTML 串缓存" | L2219–2238 |
| 后端故障/实体不匹配走 **503 + `no-store`**，绝不允许被缓存 | `serviceUnavailableResponse` L1392–1413 |
| 未分析仓库返回 200 noindex 占位页 `public, max-age=60` | L298 附近 |
| `frontend/public/_headers` 只对**静态资产**生效；首页等 HTML 由 Pages Function 动态生成（`injectHome` 替换构建产物里的 `<div id="root">`），`_headers` 无法控制这些响应 | 函数结构 + [实测]（`/docs/*` 响应头来自 `_headers`，`/` 来自 Function） |

### 1.4 Beacon 现状（[实测]）

- 每个抓取的页面（含 `/`、`/compare`、已缓存的 `/stats` HIT 副本、报告页 HIT 副本）**都恰好只有 1 个** Web Analytics 注入标签：

  ```html
  <!-- Cloudflare Pages Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "71af94b0ca2c4711a817b0cb99d9eb5b"}'></script><!-- Cloudflare Pages Analytics -->
  ```

- `beacon.min.js` 实取 **30,294 字节**（未压缩）。文件内容里没有可读的第二脚本 URL，但 [文档+网络观测] Cloudflare 的 beacon 是"两段式"：注入的 `beacon.min.js` 是 stub，运行时再动态加载**带版本哈希的模块**（形如 `…/beacon.min.js/v<hash>/…`）。计划文档里 Lighthouse 看到的"两份 payload（一个无版本路径 + 一个带版本路径），合计约 20 KiB"，与此完全吻合：**那是单个 beacon 的两个文件，不是两次注入。**
- 页面里另有一个 `…/cdn-cgi/challenge-platform/scripts/jsd/main.js` 的内联加载器（Bot Fight Mode / JS Detections，每次请求的内联脚本带当日 ray id —— `/` 与 `/?foo=bar` 响应体的唯一差异就是它）。**它与 beacon 无关**，是计划中已知的独立 CSP 控制台报错问题，不在本方案范围内。
- **[实测]** 缓存命中的响应体里 beacon 仍然存在（`/stats` 的 HIT 副本含 1 个 beacon 标签）→ 给 `/` 等新增边缘缓存**不会**丢失 beacon 注入。

---

## 2. 变更一（待应用）：新增 Cache Rules 覆盖 DYNAMIC 的公开页面

### 第 0 步：先导出/记录现状（必做）

对 zone `octocounts.com`：

1. 控制台进入 **Caching → Cache Rules**（[文档] 创建入口为 zone → caching → cache-rules，页面右上 **Create rule**）。
2. 逐条打开现有规则，记录：规则名、**完整匹配表达式**、Cache eligibility、Edge TTL、Cache Key 设置、顺序位置（可截图或复制 JSON；API 的话 `GET zones/<zone_id>/rulesets/phases/http_request_cache/entrypoint`）。
3. 确认现有规则与本文新规则**没有同设置冲突**；若某条现有规则已经匹配 `/`、`/compare` 等（例如以 Bypass 或宽泛匹配出现），按下文"顺序"小节处理（新规则放最后，后匹配覆盖先匹配）。

### 新规则 1：`octocounts-public-pages-respect-origin`

- **匹配表达式**（表达式编辑器/Edit expression 原文）：

  ```
  http.host eq "octocounts.com" and (http.request.uri.path in {"/" "/compare" "/diff" "/badges" "/extension" "/trending.xml"} or starts_with(http.request.uri.path, "/compare/"))
  ```

  UI 构建器等价操作：Field `Hostname` equals `octocounts.com`，AND（Field `URI Path` is in `/`、`/compare`、`/diff`、`/badges`、`/extension`、`/trending.xml`，OR Field `URI Path` starts with `/compare/`）。
- **Then → Cache eligibility**：**Eligible for cache**。
- **Edge TTL**：选 **"Use cache-control header if present, bypass cache if not"**（API 模式 `bypass_by_default`）。即完全尊重 origin 的 300/600；origin 没发 cache-control 的响应（例如尾部斜杠 308 重定向）自动不缓存。
- **Browser TTL**：**Respect origin**（不改浏览器侧行为）。
- **Cache Key**：**保持默认，不配置任何 custom key**（不要启用 "Ignore query string"、不要加 device type/headers）。默认 key = 完整 URL（含查询串），这是第 2.3 节正确性的根基。
- **顺序（Place at）**：放在所有现有规则**之后**（列表最底部）。[文档] 多条规则同时命中且设置相同项时，**最后一条匹配规则的设置生效**（developers.cloudflare.com/cache/how-to/cache-rules/order）。

### 新规则 2（可选，收益小）：`octocounts-embeds-respect-origin`

```
http.host eq "octocounts.com" and starts_with(http.request.uri.path, "/embed/github/")
```

设置同规则 1。embed 是第三方 iframe 页，回源 TTFB 约 0.5s [实测]，缓存有益但流量低；可以不做。

### 2.2 TTL 选择理由（为什么不直接上 1 天）

Edge TTL 选"尊重 origin"意味着新覆盖页面与已验证稳定的 `/stats`、`/github/*` 完全同一行为：边缘 5 分钟 + SWR 6 分钟。**不把 Edge TTL 覆写成 1 天**，理由：

1. **数据新鲜度是产品决策而非技术残留**：报告页代码注释 [代码 L342–345] 明确解释过"HTML 不比数据源多缓存一天"——curated compare、badges、extension 页的 SSR 标题/描述同样携带 live 统计（stars/行数），缓存一天会让 SEO 快照与真实数据脱节。工具页没有理由比报告页更宽松。
2. **发布自愈窗口**：Pages 每次部署后 HTML shell 即变（`injectHome` 注入内容、CSP 哈希随构建变化）。300s TTL + 600s SWR 把"忘了 purge"的最坏陈旧窗口钉在约 5–10 分钟；TTL 一天则必须记着每次部署后 purge。
3. **与现有缓存一致，回归面最小**：`/stats` 等已在这种模式下稳定运行（本次实测 HIT/EXPIRED/REVALIDATED 全部符合预期）。
4. **错误/事故传播上限**：万一有错误内容进入缓存，5 分钟后自愈。

预期收益（诚实估计）：`/` 与 `/compare` 的 DYNAMIC TTFB 约 230–680ms [实测]，命中后参照 `/stats` HIT 约 230–290ms——**提升为中等幅度**；真正大的收益在 curated compare（首次 1.4s）与未来冷路径。不要期待首页 TTFB 归零（边缘命中仍有一次往返）。

### 2.3 Cache key 与格式隔离（为什么不会串 HTML/Markdown）

- **HTML 与 markdown 天然不串**：`.md` 后缀和 `?format=md` 是**不同的 URL**，默认 cache key 含完整路径+查询串，各自是独立条目。已实测同一分钟内 `/github/facebook/react` 为 HIT、`?format=md` 为 MISS [实测]。
- **仅凭 UA 的 markdown 不会进缓存也不会污染 HTML**：仓库已把它改为 `private, no-store` + `Vary: User-Agent` [代码 L2219–2238]，本次实测 `/extension` 带 `PerplexityBot/1.0` UA 确实返回 `text/markdown; private, no-store; vary: User-Agent; DYNAMIC`。**"Use cache-control header if present, bypass cache if not" 模式尊重 no-store**，该变体永远不入缓存。
- **必须知道的既有行为（不是 bug，需接受）**：URL-only key 下，AI 检索 bot 请求**已缓存的 HTML 路径**会拿到缓存 HTML 而非 markdown 孪生——本次实测 `/stats` + PerplexityBot UA 返回 `HIT` 的 `text/html`。这是现有 `/stats`、`/github/*` 已经存在的语义，新规则只是让 `/`、`/compare` 加入同一语义。正确性无恙：搜索引擎爬虫（Googlebot/Bingbot）本就不参与 UA-markdown 分流 [代码 L84–87]，用户与爬虫看到同一 HTML，无 cloaking 风险；AI bot 只是拿不到"更易解析"的版本，仍可用显式 `.md` URL。
- **为什么不能靠 `Vary: User-Agent` 在 CDN 分区**：Cloudflare 的共享缓存按 key 存取，`Vary` 头不是可靠的分区机制（这正是仓库注释选择 no-store 而非依赖 Vary 的原因）。本方案不引入任何 UA 维度 key，回避整个问题。
- **不要启用 "Ignore query string"**：报告类 URL 的查询串承载 ref/commit/analysis/分页/排序语义。本规则覆盖的 `/`、`/compare` 等虽然已实测查询串不改变应用输出（`/` 与 `/?foo=bar` 响应体除 Cloudflare 自注入的 JSD 脚本外逐字节相同 [实测]），但保持全站统一默认 key 最不易出错，跟踪参数带来的碎片化可忽略。

### 2.4 明确排除项

| 排除对象 | 机制与现状 |
| --- | --- |
| POST / 非 GET 请求 | Cloudflare 默认不缓存非 GET [文档]；且 octocounts.com 前端 Function 无 POST 端点（分析任务 POST 到 api.octocounts.com，本规则 hostname 限定 `octocounts.com`，不涉及 API 域） |
| 错误状态 | `serviceUnavailableResponse` 503 + `no-store` [代码 L1392–1413]；所选 Edge TTL 模式尊重 no-store → 不缓存。这也是不要改用 "Ignore cache-control header and use this TTL" 的核心理由 |
| 私有/认证响应 | 站点无登录态页面；`private`/`no-store`/`Set-Cookie` 响应默认不缓存 [文档] |
| 无 cache-control 的响应（如尾部斜杠 308、`.html` 308、legacy 308） | "bypass cache if not" 分支自动跳过 [文档]；308 语义不被缓存放大 |
| `/github/*`、`/stats`、`/recent`、`/popular`、`/trending`、`/hall-of-monoliths`、`/sitemap*.xml` | **不加入新规则匹配集合**，完全留给现有规则，避免任何干扰 |
| `/docs/*`、`/research` | 静态资产走 `_headers`（`max-age=3600` / `max-age=0, must-revalidate`），与 Function HTML 管道不同。如以后想缓存 `/docs/*`，单独评估（origin 无 s-maxage，须谨慎），本方案不动它们 |
| bfcache | 方案不改浏览器可见响应头（Browser TTL = Respect origin），对浏览器往返导航缓存无影响 |
| 失效（invalidation） | 部署后 HTML URL 不变。默认依赖 300s TTL 自愈；如需立即生效按第 4.4 节 purge |

---

## 3. 变更二（待确认/待应用）：Beacon 保持"恰好一份"

### 3.1 定位结论（证据等级：高）

- **[实测]** 每页恰好 1 个 `data-cf-beacon` 标签，注释标记为 `<!-- Cloudflare Pages Analytics -->`。这个标记是 **Cloudflare Pages 项目级 Web Analytics（Metrics）注入**的特征（zone 级自动注入不产生该 Pages 标记）。
- **[推断，置信度高]** 唯一活跃来源 = **Pages 项目的 Web Analytics（Workers & Pages → 项目 → Metrics）**。"两份 payload"是单个 beacon 的 stub + 版本化模块结构，不是双注入；若 zone 级自动注入也开着，页面上应出现**两个** beacon 标签——实测只有一个。
- zone 级 Web Analytics 自动注入（account → Web Analytics → 站点卡片）应当处于未启用/未添加状态——**这一步是待你在控制台确认的**（编写 agent 无法看到）。
- "去重到一份"很可能**不需要任何操作**：现状已经是一份。本节的目的是（a）确认没有第二个来源潜伏，（b）防止未来开启 zone 级注入时变成真·双份。

### 3.2 控制台确认步骤（[文档] 路径，来自当前官方文档）

1. **Pages 项目开关**：控制台 → **Workers & Pages** → 选择 octocounts 前端的 Pages 项目 → **Metrics**（指标）页 → 查看 Web Analytics 的 Enable/Disable 状态。当前证据预测：**已启用**（页面上有 Pages 标记的 beacon，token `71af94b0ca2c4711a817b0cb99d9eb5b`）。注意官方说明：该开关改动后"下一次部署"才注入/移除脚本。
2. **zone 级自动注入**：控制台 → 切到账户级 **Web Analytics**（直达 `dash.cloudflare.com/?to=/:account/web-analytics`）→ 查看 `octocounts.com` 是否已作为站点添加：
   - 未添加 → 无第二来源，符合预期，**无需动作**；
   - 已添加 → 点站点卡片 **Manage site**，查看安装模式；若是自动注入（proxied 站点默认自动注入），确认它是否真的在注入（页面上只有 1 个 beacon 说明当前没有）；为杜绝后患，可将其改为 **Disable** 或移除该站点，只保留 Pages Metrics 一份。
3. **Token 对照**（可选，最硬的证据）：Pages Metrics 关联的 token 与 zone WA 站点的 token 若不同，且页面只出现其中一个，即可精确指认来源。页面当前 token：`71af94b0ca2c4711a817b0cb99d9eb5b`。

### 3.3 推荐的单一来源配置

保留 **Pages Metrics（现状）这一份**，不要在 zone 级 Web Analytics 再对 `octocounts.com` 开自动注入。理由：现状已被实测为恰好一份且数据在上报；改动越少越好。若你更倾向 zone 级（统一在 Web Analytics 界面看多站点数据），则反向操作：关 Pages Metrics、开 zone 自动注入——**二者只留其一**。另外已知坑 [文档]：若以后给 origin 响应加 `cache-control: public, no-transform`，Cloudflare 将无法注入 beacon——本方案不改这些头，不受影响。

### 3.4 Beacon 验证（应用/确认后）

```sh
# 仍应恰好 1 个 beacon 标签、1 个 token
rtk proxy curl -sS --compressed https://octocounts.com/ | grep -c cloudflareinsights          # 期望 1
rtk proxy curl -sS --compressed https://octocounts.com/ | grep -o "data-cf-beacon='[^']*'"    # 期望仅 1 条，token 不变

# 浏览器 DevTools → Network：仅一个 beacon.min.js + 一个 /v<hash>/ 模块请求；
# 交互后可见一次 POST /cdn-cgi/rum（Web Analytics 上报端点）。
# Web Analytics 看板（Pages Metrics 或 zone WA）当天仍有访问数据。
```

### 3.5 Beacon 回滚

改动的是开关，回滚 = 把对应开关拨回原状态（Pages：Metrics → Enable；zone：Manage site → 恢复原模式）。开关不影响缓存规则，二者独立。

---

## 4. 验证计划（Cache Rules 应用后按序执行）

所有命令遵守仓库规则带 `rtk` 前缀；`-D` 存证据到 `/tmp`。

### 4.1 应用前基线（若尚未应用，可直接复跑本节）

```sh
for p in / /compare /diff /badges /extension /trending.xml /compare/react-vs-vue; do
  rtk proxy curl -sSI --compressed "https://octocounts.com$p" | grep -iE '^(cf-cache-status|age|cache-control)'
done
# 现状期望：全部 cf-cache-status: DYNAMIC（与 1.1 节一致）
```

### 4.2 命中与 Age

```sh
# 每条路径连打两次：第 1 次期望 MISS，第 2 次期望 HIT 且 age>0
rtk proxy curl -sS --compressed -D /tmp/verify-home.h -o /dev/null -w 'home1 %{http_code} ttfb=%{time_starttransfer}\n' https://octocounts.com/
rtk proxy curl -sS --compressed -D /tmp/verify-home2.h -o /dev/null -w 'home2 %{http_code} ttfb=%{time_starttransfer}\n' https://octocounts.com/
grep -hiE '^(cf-cache-status|age|cache-control)' /tmp/verify-home.h /tmp/verify-home2.h
# 对 /compare、/diff、/badges、/extension、/trending.xml、/compare/react-vs-vue 重复
```

### 4.3 TTL 到期刷新（SWR 行为）

```sh
# 等 ≥301 秒后再请求：期望 EXPIRED（serve-stale 并回源刷新）或 MISS→重新 HIT，
# 与 /stats、/trending 的既有表现一致 [实测参照]
rtk proxy curl -sSI --compressed https://octocounts.com/ | grep -iE '^(cf-cache-status|age)'
```

### 4.4 部署后的失效（purge）

控制台 → zone `octocounts.com` → **Caching → Configuration → Purge Cache**（[文档+changelog] Custom Purge → By URL 可精确清除；所有 purge 方式现已全计划可用）：

- **By URL**：逐条粘贴 `https://octocounts.com/`、`https://octocounts.com/compare` 等（带查询串的变体要单独列出——purge by URL 按精确 URL 匹配）。
- **Purge Everything**：不确定时使用，代价是 `/github/*` 等既有缓存也一并清空（会短暂回到 MISS/EXPIRED，随后自动回填，无正确性风险）。
- [文档] purge 返回 200 只代表受理，不保证已清；**必须复跑 4.2 确认 MISS→HIT 重建**。

### 4.5 既有缓存回归（不得回归项）

```sh
rtk proxy curl -sSI --compressed https://octocounts.com/github/facebook/react | grep -iE '^(cf-cache-status|age|last-modified)'   # 期望 HIT/EXPIRED/REVALIDATED，last-modified 仍在
rtk proxy curl -sSI --compressed https://octocounts.com/stats | grep -iE '^(cf-cache-status|age)'                                 # 期望 HIT
rtk proxy curl -sSI --compressed https://api.octocounts.com/api/stats | grep -iE '^(cf-cache-status|age)'                         # 期望 HIT（API 域不受影响）
rtk proxy curl -sSI --compressed https://octocounts.com/recent | grep -iE '^cf-cache-status'                                      # 期望 HIT/EXPIRED
```

### 4.6 错误不缓存 / 格式不串用

```sh
# markdown 显式变体是独立条目，类型正确
rtk proxy curl -sSI --compressed 'https://octocounts.com/compare/react-vs-vue?format=md' | grep -iE '^(cf-cache-status|content-type|cache-control)'   # text/markdown; 3600/86400，与 HTML 条目互不影响
rtk proxy curl -sSI --compressed 'https://octocounts.com/compare/react-vs-vue.md'      | grep -iE '^(cf-cache-status|content-type)'                  # 同上

# 仅 UA 的 markdown 仍然 no-store、DYNAMIC（用任意 AI 检索 bot UA）
rtk proxy curl -sS --compressed -A 'PerplexityBot/1.0' -D - -o /dev/null https://octocounts.com/extension | grep -iE '^(cf-cache-status|cache-control|vary|content-type)'
# 期望：text/markdown; private, no-store; vary: User-Agent; DYNAMIC

# AI UA 命中已缓存 HTML（既有语义，非回归）：对已 HIT 的 / 断言拿到 text/html
rtk proxy curl -sS --compressed -A 'PerplexityBot/1.0' -D - -o /dev/null https://octocounts.com/ | grep -iE '^(cf-cache-status|content-type)'          # 期望 HIT + text/html

# 尾部斜杠 308 不被缓存（无 cache-control 头 → bypass 分支）
rtk proxy curl -sSI --compressed https://octocounts.com/compare/ | grep -iE '^(HTTP/|cf-cache-status|location)'                                        # 期望 308 + DYNAMIC

# 503 no-store 无法从外部稳定触发（需后端故障/实体不匹配）；代码路径为唯一依据。
# 若线上任何时刻观察到 5xx，断言其 cf-cache-status 必为 DYNAMIC；一旦发现 5xx 被缓存，立即按第 5 节回滚。
```

### 4.7 判定标准（验收）

- 4.2：新覆盖路径 MISS→HIT 且 `age` 递增。
- 4.3：TTL 后出现 EXPIRED/REVALIDATED（或重建 MISS→HIT）。
- 4.5：全部维持既有命中，`last-modified` 与 304 再验证不消失。
- 4.6：`content-type` 三态（html / markdown / no-store+markdown）互不污染；308 与 5xx 永不缓存。
- 3.4：beacon 恰好一份且数据仍在上报。

---

## 5. 回滚

**原始状态**：`/`、`/compare`、`/diff`、`/compare/*`、`/badges`、`/extension`、`/trending.xml` 无任何缓存规则覆盖（DYNAMIC）；beacon 一份（Pages Metrics）。

- **缓存规则回滚**：控制台 → Caching → Cache Rules → 找到 `octocounts-public-pages-respect-origin`（及可选的 embeds 规则）→ **Delete**（或先 Disable 观察）。因 Edge TTL 尊重 origin，删除后无需 purge——条目最长 300s+SWR 600s 自然过期；如需立即回滚干净，对涉及 URL 执行一次 Custom Purge → By URL。既有 `/github/*`、`/stats` 等规则**从头到尾未被修改**，不受影响。
- **出现串格式/串实体/错误被缓存**（最坏情况）：立即 Delete 新规则 → Purge 受影响 URL（按授权执行）→ 复跑 4.5/4.6 确认既有行为恢复。
- **beacon 回滚**：见 3.5。

---

## 6. 适用性检查（本方案明确"不破坏"清单）

1. `/github/*` 报告的 EXPIRED→HIT→REVALIDATED 与 Last-Modified/304 行为保持（新规则不匹配这些路径）。
2. `/stats`、`/recent`、`/popular`、`/trending`、`/hall-of-monoliths`、`/sitemap*.xml` 的既有命中保持（同上）。
3. `api.octocounts.com` 完全不在规则范围内（hostname 限定）。
4. 503 + no-store 错误路径保持不可缓存（Edge TTL 模式尊重 origin；这也是禁止改用 TTL 覆写模式的原因）。
5. markdown 三通道不串：显式 `.md`、显式 `?format=md`（独立 URL 独立条目）、UA-only（no-store，永不入缓存）。`Vary: User-Agent` 不被当作 CDN 分区依据（与仓库既有设计一致）。
6. 尾部斜杠 / `.html` / legacy 的 308 重定向不被缓存（无 cache-control → bypass 分支）。
7. Beacon：新覆盖路径的缓存命中体仍含恰好一份 beacon [实测已在 HIT 副本上验证]。
8. `_headers`、CSP、HSTS、COOP 等安全头与静态资产缓存不受影响（未改动任何仓库文件；本方案纯外部配置）。

---

## 附录 A：本次未做 / 未覆盖

- 未导出任何真实 Cloudflare 规则（无权限）——现有规则表达式是黑盒，只能靠第 0 步由你导出核对。
- 未实测 `/embed/*` 缓存后的表现（规则 2 为可选项，未纳入验收必测）。
- 未触发真实 503（需要后端故障），错误路径结论基于代码 + 文档。
- 未处理 Bot Fight Mode / JSD 的 CSP 控制台报错（独立已知问题，勿与 beacon 混淆）。
- `/docs/*`、`/research` 的边缘缓存留作后续独立评估。

## 附录 B：证据文件（`/tmp`，编写本文件时的原始输出）

`/tmp/p3-home-{1,2,3}.{headers,html}`（/ 3×）、`/tmp/p3-compare-{1,2}.*`、`/tmp/p3-stats.headers` 与 `/tmp/p3-stats-{2,3}.*`（MISS→HIT→HIT）、`/tmp/p3-badges.*`、`/tmp/p3-diff.headers`、`/tmp/p3-report-{1,2}.*`（HIT/REVALIDATED）、`/tmp/p3-apistats-{1,2}.*`、`/tmp/p3-page-<path>.{headers,body}`（recent/popular/trending/hall-of-monoliths/extension/compare-react-vs-vue/trending.xml/embed/docs/research）、`/tmp/p3-stats-aiua.*`（AI UA 拿到 HIT HTML）、`/tmp/p3-extension-aiua.*`（AI UA markdown no-store）、`/tmp/p3-home-q.html`（查询串对照）、`/tmp/p3-beacon.min.js`、`/tmp/p3-404repo.*`（未分析仓库占位页）。

## 附录 C：参考文档（2026-09 检索）

- Cache Rules 创建/设置/顺序：<https://developers.cloudflare.com/cache/how-to/cache-rules/create-dashboard/>、<https://developers.cloudflare.com/cache/how-to/cache-rules/settings/>、<https://developers.cloudflare.com/cache/how-to/cache-rules/order>（Edge TTL 三种模式的准确 UI 名称与"最后匹配规则生效"均出自此处）
- 默认缓存行为（HTML 默认不缓存、no-store/private/Set-Cookie/非 GET 不缓存）：<https://developers.cloudflare.com/cache/concepts/default-cache-behavior/>
- Purge（Caching → Configuration → Purge Cache；Custom Purge → By URL；200≠已清除）：<https://developers.cloudflare.com/cache/how-to/purge-cache/> 及 cache changelog（2025-04 起 purge 方式全计划开放）
- Web Analytics：zone/账户级开启与自动注入、Manage site 模式、no-transform 限制：<https://developers.cloudflare.com/web-analytics/get-started/>；Pages 项目一键接入路径（Workers & Pages → 项目 → Metrics → Enable，下次部署注入）同页；beacon 变更日志（module 注入、`/cdn-cgi/rum` 上报端点）：<https://developers.cloudflare.com/web-analytics/changelog>
- 计划文档：`astra-improve.md` 第 6 节 P3、7.3、7.4、8 节。
