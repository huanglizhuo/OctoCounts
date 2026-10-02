# OctoCounts 代码增长动画 — 实现计划

> 2026-09-30 · 基于已验证的 HyperFrames 原型(10s 模板,v1 已于 2026-10-01 随 v0.7.22 上线)
> 需求:用户仅提供 repo URL → webapp 内取数 → 模板化 JS 动画 → 页内播放(点击播放/自动循环)+ GIF 导出

---

## 0. 需求细化(确认版)

| 项 | 决定 |
|---|---|
| 入口 | 报告页(`/github/:o/:r`)新 section,分析完成后出现("Watch this repo grow") |
| 用户输入 | 仅 repo URL(即报告页本身);**零新增后端端点** |
| 数据源 | 现有 `GET /api/seo/report`(当前语言构成+总数)+ `GET /api/seo/repo-history`(SLOC 历史 12-13 点 + stars) |
| 播放 | 点击播放/暂停/重播;进度条可拖;循环默认关闭,可手动开启;完成停终帧 |
| 导出 | GIF 下载(原生 1280×720);固定全长 10s,100 帧,10fps |
| 模板 | 与 demo 完全同构的四幕:terminal hook → count-up+race+dips → 条形→donut 变形 → 统计视图定格 |
| 主题 | 复用 matrix/paper 双主题变量;GIF 固定 matrix 调色板 |
| i18n | EN/ZH 全量 |
| 无障碍 | prefers-reduced-motion 默认停终帧+手动播放;键盘可达;SSR 保留文字摘要 |

**数据诚实性**:SLOC 曲线与终帧统计为真实数据;**历史语言占比为建模值**(按当前构成比例缩放,demo 同款)。UI 以一行小字披露("language split modeled from current snapshot")——这是 v1→v2 的明确边界。

## 1. 范围

- **v1(本计划)**:报告页 section;纯前端;DOM/SVG 播放 + GIF 导出;无新后端。
- **v2(§12,不实施)**:后端 per-language 历史采样(真 race);WebM 导出;独立 `/growth/:o/:r` SEO 路由;分享卡导出。

## 2. 架构与数据流

```
report + repo-history (现有 API)
        │
        ▼
  buildScene() ── 纯函数:归一化、插值、节拍表、dip 检测、语言时序建模
        │
        ▼
   GrowthScene(确定性数据契约:节拍×元素状态,不含时间副作用)
        │
        ├──▶ GrowthAnimation.tsx   render(p) ── SVG/DOM 演染(rAF 驱动播放)
        └──▶ exportGif.ts          render(pᵢ) ── 隐藏 1280×720 克隆逐帧步进 → html-to-image → gifenc
```

**继承 demo 的三条核心原则**:
1. **纯函数 `render(progress)`**:同一渲染函数服务播放/循环/seek/导出,确定性(无 Date.now/random/网络)
2. **单一时间轴**:所有元素(counter/bars/playhead/stars)读同一个 p,由节拍表映射
3. **SVG dasharray 几何**:donut 弧长 = 占比×周长(demo 已验证的公式与交接数学)

## 3. 模块分解(全部新文件,不动现有组件)

| 文件 | 职责 | 要点 |
|---|---|---|
| `src/growth/types.ts` | GrowthScene 契约 | 幕/节拍/语言序列/dip 事件/终帧统计 |
| `src/growth/buildScene.ts` | 数据→场景 纯函数 | 插值(时间↔样本线性映射)、**dip 检测**(相邻样本降幅>30% → amber 节拍)、语言建模(当前占比×总量曲线)、低样本降级(<3 点:跳过 race 幕)、单语言边界 |
| `src/growth/GrowthAnimation.tsx` | render(p) 渲染组件 | SVG(环弧/donut)+ DOM(计数器/表格);固定 16:9 stage,缩放容器复用 `useElementScale` 模式 |
| `src/growth/useGrowthPlayer.ts` | rAF 播放器 | play/pause/loop/seek;`matchMedia('(prefers-reduced-motion: reduce)')` 默认停终帧;`visibilitychange` 暂停 |
| `src/growth/exportGif.ts` | GIF 导出 | 隐藏克隆 1280×720;10fps 逐帧步进(全长100帧);等待字体加载;固定最多256色调色板;动态 import html-to-image+gifenc;进度回调+取消 |
| `src/report/GrowthSection.tsx` | 报告页接入 | `React.lazy` + Suspense;SSR 摘要文字(爬虫可见);触发 GA 事件 |
| `src/locales/{en,zh}.json` | 文案 | ~15 键 |
| `styles.css` 增量 | 样式 | `.growth-*`;复用 `--accent/--bg-2/--rule` 等变量双主题 |

## 4. 场景规范(四幕,10s @ 播放 60fps / GIF 10fps)

| 幕 | 时间 | 内容 | 数据规则 |
|---|---|---|---|
| 1 hook | 0–1.2s | 终端打字 `$ octocounts :o/:r` + 计数器预滚 | repo 名动态 |
| 2 演化 | 1.2–8.5s | count-up 锁首个样本→跟随曲线;语言条 race;dip 节拍(count-down+amber+时间轴标记);stars 尾段进场 | 真实样本线性映射(4,435天→7.3s 同款);**dip 阈值 -30%** |
| 3 变形 | 8.55–9.3s | 条形坍缩堆叠条 → 六弧环绕成环(dasharray 生长,JS 先) | demo 几何原样移植;颜色=语言色贯穿 |
| 4 定格 | 9.3–10s | 环心读数+头部+指标行+top10 表+TOTAL 级联;9.6s 起静态 | 与报告页 Charts 同数据源(top N+TOTAL) |

**循环**:末帧停 0.6s → 淡出 0.3s → 回首帧(循环开时);进度条与播放头共享 p。

## 5. GIF 导出规范

- 原生画布 1280×720,scale 1;固定全长 10s(100 帧),低样本场景也保留完整时间线
- 帧延迟 100ms(10fps);从第 35 帧生成最多 256 色的固定调色板;`GIFEncoder({ auto: true })` 流式
- 栅格化前等待字体加载完成;当前示例实测约 2.5MB,生成约 6 秒
- UI:导出按钮 + 进度条(逐帧计数)+ 取消;完成触发 `trackEvent(growth.gif_exported)`
- 文件名 `octocounts-{owner}-{repo}-growth.gif`

## 6. 性能与包体预算

- growth 模块 React.lazy 独立 chunk,**<25KB gzip**(不引入 GSAP —— demo 的单驱动架构本来就是纯 render(p),rAF 足够)
- 播放:rAF 单帧 O(语言数×常数),60fps 无压力;导出期间冻结播放器共用同一 p
- 现有 vendor(193KB)不受影响

## 7. SEO / SSR 纪律(与审计修复一致)

- section 为客户端增强:SSR 输出文字摘要(标题+首末样本数字+"watch the evolution"文案+内链)——爬虫可见、零 CLS(固定高宽容器)
- 独立 growth 路由与 sitemap 是 v2(程序化 5k 页的决策单独做)

## 8. 测试计划

1. `buildScene.test.ts`:插值正确性、dip 检测阈值、语言建模总和=100%、边界(1 语言/2 样本/无历史→禁用态文案)、三样本压缩节拍
2. `useGrowthPlayer`:循环边界、reduced-motion 默认态(mock matchMedia)
3. 组件冒烟:render(0)/render(0.5)/render(1) 关键数字断言(沿用 qa/playwright 现有截图模式)
4. `exportGif`:mock toCanvas 帧序列,断言帧数/延迟/调色板;取消路径
5. 门禁:`npx tsc --noEmit` + `npm test` 全绿(seo.test 81 项不受影响)

## 9. 实施顺序(可并行的标 ◇)

| # | 任务 | 估时 |
|---|---|---|
| 1 | types + buildScene + 单测 | 0.5d |
| 2 ◇ | GrowthAnimation 四幕静态渲染(p=0/0.5/1 三态) | 1d |
| 3 | useGrowthPlayer(播放/循环/seek/reduced-motion) | 0.5d |
| 4 | morph 移植 + 缓动打磨 + dip 节拍 | 0.5d |
| 5 ◇ | exportGif + 进度 UI(依赖 2 的渲染稳定) | 1d |
| 6 | 报告页集成 + lazy + i18n + analytics + SSR 摘要 | 0.5d |
| 7 | QA:playwright 双主题截图、键盘、循环、导出实测、`npm run build` | 0.5d |
| | **合计** | **~4.5 人日** |

## 10. 风险与决策点

| 风险 | 缓解 |
|---|---|
| 100 帧 html-to-image 导出耗时(估 8–20s) | 进度条+取消已是先例模式;若实测 >30s → v1.1 增 canvas 导出路径(render 双后端,纯函数架构已预留) |
| GIF 体积 | 固定10秒、10fps、原生1280宽、固定调色板;当前示例约2.5MB,以楼顶文字清晰度优先 |
| 语言历史缺失(race 无重排戏剧性) | v1 比例建模+文案披露;v2 后端采样(扩展 `ensure_repo_history` 存 per-language) |
| 低样本 repo(<3 点) | buildScene 降级:count-up+morph 两幕,race 幕跳过 |
| 动画 CLS/性能回归 | 固定尺寸容器 + lazy + rAF 暂停(不可见页签)—— 审计纪律不回退 |

## 11. 验收标准

- [ ] 报告页分析任一公开 repo 后,一键播放 10s 动画,数字与报告一致(终帧 TOTAL 校验)
- [ ] 循环/暂停/seek/重播全部可用;reduced-motion 下默认终帧
- [ ] GIF 导出可用,帧率/时长/调色板正确,文件 ≤8MB(全长)
- [ ] growth chunk <25KB gzip;Lighthouse 移动分不回退(CLS 保持 0,启动 bar 移除后基线)
- [ ] EN/ZH 完整;键盘可达;tsc + npm test 全绿
- [ ] SSR 摘要出现在报告页源码中(爬虫可见)

## 12. v2 展望(明确不在 v1)

1. **后端 per-language 历史采样**(真 race/真语言进场时间)—— 新端点 `repo-history-languages` 或扩展现有存储,仅对已索引仓库惰性回填
2. **WebM 导出**(MediaRecorder + captureStream,体积 ~1/10,适合 10s+)
3. **独立 `/growth/:owner/:repo` 路由**:SSR 首帧 + og:video + sitemap 分片 —— 程序化 SEO 增长面(与 compare 页同纪律:lastmod/清理门)
4. 终帧一键 PNG 分享卡(复用现有 ShareTickerCard 管线)
5. 用户可调参数(时长/主题/语言数)存 URL query,可分享配置


---

## v1.1 代码城市改版(2026-10-02)

四幕条形图(hook → race → morph → finale 表)重写为**等距 3D 代码城市(Isometric Code City)**:每种语言一栋楼,底面积 ∝ 当时代码占比(squarified treemap),楼高 ∝ 当时行数;城市从空地生长为天际线。

### 节拍(10s 模板不变)

1. **hook 0–1.2s**:终端打字,完全保留。
2. **生长 1.2–8.5s**(替代旧 data 幕):空地块(等距底板+网格)开场;楼按终态代码排名错峰 0.15s 拔起(quartOut);楼高/底座在相邻采样点布局间按楼名插值,跟随与同一条 eased sample clock —— dip 段先持平再 cubic-in 下陷,楼群自体演绎 dip,外加琥珀描边闪烁与时间轴琥珀刻度;stars 信标(发光菱形+计数)悬浮在最高楼顶。
3. **定格 8.5–10s**(替代旧 morph+finale):楼顶浮现标签(语言名+行数,最短边≥13 且面积≥220 地面单位的顶面才显示);底部滑入指标条(files/code/comments/blanks/年份跨度,来自 `scene.finale.metrics`);9.6s 后静态。

### 契约变化(types.ts / buildScene.ts)

- `GrowthSample.city: GrowthCityBlock[]`:每采样点的 squarified treemap 布局(rect 在 100×100 地面网格内、互不重叠、面积 ∝ value)+ 设计 px 楼高(全序列最高峰=180px,跨帧可比)。超过 8 栋楼时尾部合并为灰色 `Other (N more)` 块(带 `merged` 计数,FALLBACK_COLOR #57606a)。
- `GrowthLanguage` 新增 `colorTop`/`colorRight`:顶面亮色/右面暗色在 buildScene 从语言色派生并烘焙(×1.28 / ×0.66),渲染器不做颜色计算(GIF 调色板确定性)。
- 删除 `acts.morph`(`stackOrder`/`ringShares`)、`GrowthLanguage.entersAtSample`(错峰改由渲染器按终态排名计算);`acts.finale` 改为 8.5–10s(staticFrom 9.6 不变)。
- 保留:hook、samples、dips、starsNow、languages、finale(表格 payload 留在契约里,舞台只渲染 metrics)、modeledLanguageSplit、finaleDiverged、variant(compact:<3 样本直接升到终态天际线,节拍表不变)。
- buildScene 新增导出 `deriveFaceColors` / `layoutCity` / `MAX_BUILDING_H`,fixture 复用同一几何,杜绝漂移。squarified treemap 为手写 ~70 行纯函数,无 d3 依赖。

### 渲染器(GrowthAnimation.tsx)

- 删除:race 条、compact 单条、stack 变形、donut 环(RingLayer)、morph 交接全部代码。
- 新增:纯 SVG 等距投影(禁止 CSS 3D/canvas):`sx = (gx−gy)·cos30°·3.4`、`sy = (gx+gy)·0.5·3.4 − z`;每栋楼 3 个 polygon(顶/左/右面),按 gx+gy 深度排序绘制(painter's algorithm);楼顶标签(SVG text + 主题色 halo);stars 信标;底部指标条。
- 保留:props 接口、`--growth-scale` 缩放、hook 幕、计数器、时间轴、aria、reduced-motion 由 player 处理。

### 删除的样式/键

- styles.css:`.growth-race-*`、`.growth-compact-bar`、`.growth-stars`/`.growth-star-*`、`.growth-stack-seg`、`.growth-ring*`、`.growth-fin-*` 全部移除;新增 `.growth-city-*`/`.growth-beacon-*`/`.growth-metrics`/`.growth-metric`。
- locales:无动画内部旧键可删(旧渲染器标签为硬编码英文);新增 `beaconAria`、`metricFiles/Code/Comments/Blanks/Span`、`otherBlock_one/_other`(EN/ZH 同步);`divergedNote` 措辞从"结尾表格"改为"结尾指标"。

### 验收(v1.1)

- [x] `npx tsc --noEmit` 通过
- [x] `node --test` buildscene/player/exportgif 全绿(40 项;新增布局边界/不重叠/面积比例/Other 合并/高度缩放/派生色断言)
- [x] `npm run build` 通过,growth chunk(GrowthSection-*.js)10.36KB gzip < 25KB
- [x] `npm run test:csp` 通过
- [x] renderToString 五帧(0/0.06/0.41/0.5/1)坐标审计无 NaN/越界 + Playwright 截图人工复核

语言 logo 使用 `simple-icons` 16.33.0 的单色 SVG path，覆盖 33 个语言名及别名，在构建场景时根据楼顶亮度选择黑色或白色。
生长幕开始就通过 SVG matrix 将 logo 投影到楼顶，语言名和实时 LOC 跟随当前楼顶位置；小楼采用紧凑文字，无对应图标或楼顶空间不足时省略 logo。
舞台底部时间轴已移除，改为右上角的年/月/日翻页卡片，每 250ms 更新一页、翻页 200ms；同一 progress 始终产生同一画面，支持 seek、重播和 GIF 导出。减少动态效果时日期直接更新，终帧显示最后采样日期。
实时标签与翻页日期版验收：growth 三组测试 42/42；`npm test` 全绿（SEO 83/83）；growth chunk 24.20KB gzip；双主题页面截图、seek 往返、减少动态效果及实际 6 秒 GIF（640×360、60 帧）已验证。
指标条改用独立的 `.growth-city-metrics` / `.growth-city-metric` 类名，避免与统计页样式冲突。
画面点击切换播放／暂停，支持 Enter／空格；独立播放／暂停按钮已移除，循环默认关闭。终幕用 500ms cubicInOut 平移城市到舞台中央，楼顶 Star 信标淡出，左上角显示 Stars，右上角保持采样日期；终帧不显示播放图标，点击终帧从头重播。导出时画面点击控制禁用，GIF 不包含交互层。该版 `npm test` 与 growth 42 项测试通过，双主题、点击、键盘、结束停止、终帧居中及实际 640×360 GIF 已验证。
