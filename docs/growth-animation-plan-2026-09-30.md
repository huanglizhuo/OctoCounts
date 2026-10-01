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
| 播放 | 点击播放/暂停/重播;进度条可拖;自动循环(默认开,可关);完成停终帧 |
| 导出 | GIF 下载(640×360);时长可选 全长10s / 紧凑6s |
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
        └──▶ exportGif.ts          render(pᵢ) ── 隐藏 640×360 克隆逐帧步进 → html-to-image → gifenc
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
| `src/growth/exportGif.ts` | GIF 导出 | 隐藏克隆 640×360;10fps 逐帧步进(全长100帧/紧凑60帧);固定 12 色调色板(沿用 `GIF_PALETTES` 模式);动态 import html-to-image+gifenc;进度回调+取消 |
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

- 画布 640×360;**全长 10s(100 帧)** 或 **紧凑 6s(60 帧,跳过 hook 幕)**
- 帧延迟 100ms(10fps);固定调色板(demo 12 色 + 语言色);`GIFEncoder({ auto: true })` 流式
- 预估:全长 3–8MB / 紧凑 2–5MB(18 帧先例的用户接受度注释适用:宁小勿重)
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
| GIF 体积 | 时长选项 + 10fps + 640 宽 + 固定调色板;文档注释沿用"宁小勿重"先例 |
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
