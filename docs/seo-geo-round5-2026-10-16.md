# SEO/GEO 第 5 轮:GitHub 仓库改名造成的索引事故修复(2026-10-16)

- 背景:第 4 轮(2026-09-19)与 2026-09-30 全站审计之后,线上出现一批 compare 页面永久 503 / 404。本轮为事故修复 + 两项审计遗留。
- 关联文档:[seo-geo-history.md](seo-geo-history.md)(第 1–4 轮)、[seo-index-runbook.md](seo-index-runbook.md)、[ACTION-PLAN](../.seo-audit/ACTION-PLAN.md)。

## 一、诊断(线上实测,2026-10-16)

### P0-A:7 个 curated compare 页持续 503

自 2026-09 起 GitHub 多个仓库迁移 org(` Moved Permanently`,经 GitHub API 确认):

| 旧名(注册表写死) | 规范名(后端/报表实际) | 受影响 slug |
|---|---|---|
| facebook/react | react/react | react-vs-vue、angular-vs-react、svelte-vs-react、solidjs-vs-react |
| facebook/react-native | react/react-native | react-native-vs-flutter |
| containers/podman | podman-container-tools/podman | docker-vs-podman |
| prisma/prisma | prisma/orm | prisma-vs-typeorm、prisma-vs-drizzle |

故障链:注册表旧名 → `/api/seo/report?owner=旧名` 返回规范名报表(后端走 rename 链)→ compare 页完整性守卫 `reportMatchesRoute` 比对失败 → 永久 503(stale-while-error 缓存随 isolate 重置而失效)。报告页不受影响,因为路由层先按 `canonicalSlug` 308 到规范路径。

其中 3 个 503 slug(react-vs-vue、angular-vs-react、svelte-vs-react、docker-vs-podman)**在 sitemap-compare.xml 里**——向爬虫持续提交 503 URL。

### P0-B:9 个 compare 页 404(sitemap 门控与页面取数口径不一致)

cmake-vs-meson、cobra-vs-urfave-cli、esbuild-vs-swc、nlohmann-json-vs-rapidjson、protobuf-vs-flatbuffers、solidjs-vs-react、styled-components-vs-emotion、threejs-vs-babylonjs、tokio-vs-async-std。

根因:后端 `repos_with_reports`(sitemap 门控)只做 `JOIN reports` 存在性检查,不过滤 `options_canonical` 与 sampler 资格;而页面取数 `latest_report_card` 要求规范 profile 的报表。仓库只有 include-all 访客分析行(或过期 sampler 行)时,pair 进入 sitemap 但页面 404。其中 6 个在 sitemap 里。9 个缺报表仓库全部在 `data/popular-repos.txt` 种子清单中,但每周 seed 只取合并列表前 50 个,长期轮不到。

## 二、修复

1. **规范名落地(前端)**:`compare-registry.js` 8 个条目改用规范名;`compare-editorial.js` 对应 scope 文案、来源链接、verifiedAt(内容真实变更 → 2026-10-16);`data/popular-repos.txt` 4 行;`src/constants.ts` defaultRepoUrl(与已再生的 demo seed react/react 对齐);SPA shell 示例链接;llms.txt(.md 示例 + 由脚本再生的 compare 段);4 个 docs 页(HTML+markdown 双胞胎)与 /research(HTML+markdown、JSON-LD、meta)的示例 URL/链接改规范名;旧 URL 的 308 保持不变。
2. **改名自愈(前端 SSR)**:完整性守卫失配时,先问后端 `/api/seo/redirect`(与报表查询不同的独立路径)确认改名,确认后按规范名渲染(标题列、报告链接、交互链接全部用规范名);无记录或查询失败 → 维持失败关闭 503。这样未来的 GitHub 改名只会自愈,不会再造成整批 503;缓存投毒不会被误当改名。测试:新增成功/失败两用例。
3. **sitemap 门控同口径(后端)**:`repos_with_reports` 补 `options_canonical` + `latest_eligible` 谓词,与 `latest_report_card` 一致——sitemap 不再承诺取不到报表的 pair。新增 store 测试。
4. **sitemap index 补 `<lastmod>`**(审计 Low 遗留):三个子片各取自身条目的最大 lastmod(static 取 STATIC_SITEMAP_ENTRIES 含 trending 快照注入后的最大值;compare 取 COMPARE_CONTENT_LASTMOD;reports 取片内最大)。测试断言三处值。
5. **日期诚信**:内容真实变更的页面按五处同步规则更新(manifest、STATIC_SITEMAP_ENTRIES、可见 Updated 行、JSON-LD dateModified、markdown 孪生):4 个 docs 页、/research、/compare、COMPARE_CONTENT_LASTMOD、llms.txt。

## 三、验证

- frontend `npm test`:93/93 通过(含新增:改名自愈成功、无 redirect 记录失败关闭、sitemap index lastmod 断言、fixture 改规范名)。
- backend `cargo test`:234 通过(store 测试本地无 Postgres 按设计跳过,CI 真跑)。
- 部署后 runbook 验证清单:7 个 503 slug 应 200 且表格列名/链接为规范名;`/sitemap.xml` 三个子片带 lastmod;`site:` 抽查。

## 四、遗留

| 项 | 说明 |
|---|---|
| 上线动作 | push 后由 Pages/镜像部署;之后按 runbook §3/§4 重新提交 sitemap、IndexNow `--core` 推送 |
| seed 覆盖率 | 每周 seed 仍只取前 50,清单第 50 名之后的报表会逐渐失效;建议改为按 ISO 周轮转偏移(本轮未做) |
| SG-08/SG-10 | 真实爬虫穿透验证与 GSC/Bing/umami 基线,依旧等后台权限 |
| 品牌提及 | Reddit/SO/HN 需登录的手工动作(见 docs/free-platform-submissions-2026-10-11.tsv) |
