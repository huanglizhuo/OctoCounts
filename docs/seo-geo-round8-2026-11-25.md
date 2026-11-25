# SEO/GEO 第 8 轮：中文指南补齐（2026-11-25）

- 触发：2026-11-25 的 GEO/SEO 剩余项审查（本轮实现的是 P2 中文覆盖与 AI 索引补齐的部分）。
- 关联文档：[seo-geo-round7-2026-11-24.md](seo-geo-round7-2026-11-24.md)（第 7 轮）、[seo-geo-history.md](seo-geo-history.md)、[seo-index-runbook.md](seo-index-runbook.md)、[seo-geo-measurement.md](seo-geo-measurement.md)。

## 一、本轮改动

| 项 | 实现 |
|---|---|
| 中文 FAQ 指南 | 新增 `/zh/docs/faq`（HTML + Markdown 孪生，`zh/docs/faq.html` 348 行、`zh/docs/faq.md`）：lang=zh-Hans、自引用 canonical、`text/markdown` 替代链接、hreflang en/zh-Hans/x-default（en 指向 https://octocounts.com/docs/faq）、og:locale zh_CN、TechArticle（inLanguage zh-Hans，datePublished/dateModified 2026-11-25）、BreadcrumbList（中文首页 → FAQ）、FAQPage @id `#faq` 含 21 条 Q/A，可见 FAQ 与 JSON-LD 的问题/答案逐字一致；四个分组（开始使用/功能与集成/方法与准确性/隐私、API 与项目）；Markdown 包含 `规范页面：`、`reportId` 与 `countingPolicy`（中文指南测试要求） |
| 英文 FAQ 刷新 | `/docs/faq` 补上 hreflang en/zh-Hans/x-default 链接、body 中的中文版本链接（`/zh/docs/faq`）、可见日期与 TechArticle dateModified 更新到 2026-11-25（HTML 与 Markdown 同时） |
| 路由与站点地图 | 边缘函数 (`frontend/functions/[[path]].js`)：`/zh/docs/faq` 加入 zh 路由与 allowlist（FAQ 的 HTML/Markdown 服务）、`/zh/llms.txt` 通过 ASSETS 服务；STATIC_SITEMAP_ENTRIES 新增 `/zh/docs/faq`（2026-11-25），`/docs/faq` 更新为 2026-11-25；manifest 新增三条记录（zh faq、zh llms.txt、llms.txt/llms-full.txt 日期） |
| nginx | `frontend/nginx.conf` 新增 `/zh/docs/faq` 路由块（含 `.md` 重写、308 跳转、trailing-slash 308） |
| 测试 | `frontend/tests/seo.test.mjs`：nginx 路由测试、localized-pages 测试、中文指南服务测试、中文重定向测试全部加入 `faq` slug；metainfo/sitemap 镜像不变（manifest 与 STATIC_SITEMAP_ENTRIES 同步，llms 仍只记录不入 sitemap） |
| AI 索引 | 新增 `/zh/llms.txt`（中文版本的 llms 结构，对齐英文 llms.txt：简短回答、用途、报告模式、API、中文重点链接、推荐引用、计数与访问说明）。`llms.txt` 与 `llms-full.txt` 的 简体中文 章节新增「中文常见问题」和「中文 AI 索引」两条链接；Last-Updated 2026-11-25 |

## 二、验证

- `cd frontend && npm run test:seo`（含 build + 160 项 SEO 测试）：157 项通过。3 项失败与本轮无关——它们读取被会话中用户本地删除的 `backend/src/seo.rs` 与 `backend/src/badge.rs`（backend 已迁移到 `/Users/lizhuo/owork/sloc-infra`；worktree 中后端文件删除为用户既有未提交状态，本轮未触碰）。
- 本轮相关测试单独执行全部通过：nginx 路由、localized-pages（en + zh + docs/faq 交叉核验 alternates、FAQPage、TechArticle、manifest、Markdown 答案逐字）、中文重定向（faq .html 308、trailing-slash 308、404 集合不变）、中文指南服务（HTML 200 + canonical、Markdown noindex + 规范页面 + countingPolicy + reportId）、sitemap 镜像（manifest/STATIC_SITEMAP_ENTRIES 同步）。
- zh FAQ 的 JSON-LD 与可见文本逐条一致性脚本检查：21 条 Q/A 的 name/text 同时出现在 HTML 与 Markdown 中。
- 产品事实检查 `npm run test:facts` 与本轮无关地失效：读取已删除的 `backend/Cargo.lock` 后以 ENOENT 退出（后端迁移的既有状态）。`.octocounts-roadmap-progress.json` 的 SG-08（中文 GEO 覆盖）标记为 in_progress。

## 三、未做与遗留（本轮不越权）

| 项 | 说明 |
|---|---|
| SG-10 度量基线 | GSC/Bing/umami/ChatGPT 采样仍需要后台权限与账号，无法从仓库自动化。`docs/chatgpt-geo-baseline.csv` 的结果字段仍为空；这是后台接入的剩余事项，见 runbook §5 与 history §4 |
| SG-08 真实爬虫穿透 | 需要生产日志确认 Googlebot/Bingbot/GPTBot 真实穿透；本轮无新增权限 |
| 站外品牌实体 | 需要维护者本人以第三方站点身份发帖（`.seo-audit/BACKLINK-PLAN.md` 清单），本轮未发布 |
| Cloudflare JS Detections | 控制台操作，需要在 Cloudflare 面板关闭 JavaScript Detections 或改 nonce 式 CSP |
| Dataset 许可 / 转私有下架流程 | 产品决策，默认不越权 |
| zh 覆盖的后续 | 中文目前为首页 + 3 指南 + llms.txt；后续中文 docs（api/cli/mcp-server/github-action 等）仍待决定，本轮只补齐用户要求的最小中文 FAQ 与 AI 索引 |

