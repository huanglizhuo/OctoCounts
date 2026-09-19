# SEO/GEO 深度优化 + Google/Bing 收录问题修复计划(2026-09-19)

- 工具:geo-seo-claude skill(v16 个子 skill,已安装到 `~/.claude/skills/` 与 `~/.agents/skills/`,含 Python venv)。
- 审计对象:https://octocounts.com/ 线上行为 + 本仓库实现。
- 前置:第 1–3 轮 SEO/GEO 计划见 `SEO-GEO-optimize-plan.md`(答案胶囊、101 对比页编辑内容、/research、schema 补强等已完成并部署)。本计划只处理**新诊断出的问题**,不重复已完成项。

---

## 一、诊断结论(证据)

### 1. Google/Bing 收录问题的根因

线上 `https://octocounts.com/sitemap.xml` 由 Pages Function 动态生成(`frontend/functions/[[path]].js` 的 `sitemapResponse`),当前包含 **4,113 个 URL**,构成:

| 类别 | 数量 | 说明 |
|---|---|---|
| 核心页 + docs + llms 文本 | 25 | STATIC_SITEMAP_ENTRIES |
| 对比页 /compare/* | 101 | indexableCompareEntries(101/101 已收录缓存) |
| **报告页 /github/{owner}/{repo}** | **3,989** | 后端 `/api/seo/sitemap` 全量输出 |

问题链:

1. **[P0] 单一 sitemap 被 3,989 个程序化报告页淹没(97%)**。新站低外链权威 + 海量按需生成的薄页 → Google 爬行预算被稀释,核心页/对比页排不上队,GSC 页面索引报告呈现数千条 "Discovered/Crawled - currently not indexed"。实测:`site:octocounts.com` 仅 ~10 页(Google 侧),`site:octocounts.com/compare` **0 页**;101 个对比页早在 2026-07-30 上线、内容已全量编辑化(774 词 SSR),收录为零不是内容问题,是发现/优先级问题。
2. **[P0] XML sitemap 混入 text/plain 资源**(`llms.txt`、`llms-full.txt`)。XML sitemap 的对象是可索引网页;非 HTML 资源会在 GSC 报"无法编制索引"类异常。llms.txt 已由 robots.txt 注释与外链引用,AI 工具直接抓取,不需要 sitemap 条目。
3. **[P1] 报告页 lastmod 语义**:`store.rs sitemap_entries` 用报告 `generatedAt`(最近一次分析时间)。重分析即使行数未变也会 bump(单日 700–900 条变动)。语义上站得住(页面可见快照时间确实变了),但大规模日变动会稀释 lastmod 信任。**本轮决策:不改后端**(改动需对比历史报告 body,收益不确定、风险高);通过 sitemap 分片把报告页与核心页隔离,变动噪音不再污染核心页信号。
4. **[P1] IndexNow 生产验证缺失**(SG-08 遗留):key 文件 `/{INDEXNOW_KEY}.txt` 由边缘函数按 env 提供,是否可达未验证;Bing 侧收录推动依赖它。

已排除的嫌疑(均正常):robots.txt 线上与仓库一致且全放行;Googlebot/Bingbot 抓取获得完整 SSR(实测 200 + 独立 title/canonical/index,follow);未知仓库页正确 noindex(无软 404);尾斜杠 308 归一;www/http 301 到 https 主域;无 X-Robots-Tag;404 正确;JSON-LD 各页齐全且可解析;markdown 协商(.md / ?format=md)正常;内链完整(/compare 索引页 SSR 输出全部 101 个链接,首页有入口)。

### 2. GEO 深度审计(skill 六维加权)

| 维度 | 权重 | 得分 | 依据 |
|---|---|---|---|
| AI Citability & Visibility | 25% | ~55 | citability_scorer 实测:首页 56 / 对比页 48.8 / FAQ 41.5 / 报告页 39.2,**全站 0 个 A 级段落**;docs/faq 22 块中 9 F + 7 D |
| Brand Authority | 20% | ~55 | GitHub + 3 商店强;Reddit/YouTube/Wikipedia 提及为零(中长期路线,非代码项) |
| Content Quality & E-E-A-T | 20% | ~75 | 101/101 对比页编辑内容、/research 原创数据、作者署名 |
| Technical Foundations | 15% | ~78 | SSR/安全头/缓存优秀;**sitemap 架构是唯一硬伤(P0-1/2)** |
| Structured Data | 10% | ~85 | @graph 齐全(Dataset/FAQPage/BreadcrumbList/SoftwareSourceCode/Speakable) |
| Platform Optimization | 10% | ~80 | 全 AI 爬虫放行、markdown 协商、llms.txt 新鲜(2026-09-17) |
| **加权总分** | | **≈ 66** | 拉分项 = sitemap 架构 + 段落可引用性 |

---

## 二、修复项(逐一实现 + 验证)

### FIX-1(P0)sitemap 拆分为 index + 子 sitemap
- `functions/[[path]].js`:
  - `/sitemap.xml` → **sitemap index**,子项:`/sitemap-static.xml`(24 核心页)、`/sitemap-compare.xml`(可索引对比页)、`/sitemap-reports-{n}.xml`(报告页,每片 ≤10,000,越界片返回空 urlset)。
  - 各子 sitemap 复用现有数据源与缓存头(`s-maxage=3600, stale-while-revalidate=86400`)。
- 删除 `public/sitemap.xml`(生产被函数遮蔽的死副本,唯一作用是 drift);manifest(`content/content-manifest.json`)仍是 lastmod 事实源。
- robots.txt 的 `Sitemap:` 行不变(仍指向 /sitemap.xml,GSC/Bing 对 index 透明)。
- **验证**:更新 `frontend/tests/seo.test.mjs` 全部 sitemap 断言 + 新增:index 结构、子片内容归属、llms 不在任何 XML、越界片空、Trending lastmod 注入保持在 static 子片。

### FIX-2(P0)llms.txt / llms-full.txt 移出 XML sitemap
- 从 `STATIC_SITEMAP_ENTRIES` 删除两行;manifest 保留其日期记录(供 llms 工具链,不进 sitemap);测试断言任何 sitemap XML 不含 llms 条目。

### FIX-3(决策:不做,记录理由)报告页 lastmod 语义
- 保持 `generatedAt`。理由:页面可见快照时间确实随重分析更新,语义诚实;后端对比历史 body 的成本/风险大于收益;分片后噪音已隔离。

### FIX-4(P1)IndexNow key 生产验证命令
- `scripts/resubmit-urls-indexnow.mjs` 增加 `--verify-key`:GET `https://octocounts.com/{key}.txt`,断言 200 且 body === key。补单测。

### FIX-5(P1)核心页 IndexNow 主动推送模式
- 同脚本增加 `--core`:拉取线上 `/sitemap-static.xml` + `/sitemap-compare.xml` 提取 `<loc>` 提交,帮助 Bing/INDEXNOW 快速发现核心页与对比页。补单测。

### FIX-6(P1)docs/faq F 级段落强化(GEO 可引用性)
- 9 个 F + 部分 D 级答案(20–45 词)扩到 50–80 词自包含答案块:补事实细节(tokei 200+ 语言、badge 类型清单、API/CLI/MCP/Action、导出格式等,全部站内可验证),不加链接堆砌、不编造数字。
- 同步:`public/docs/faq.md` 孪生、JSON-LD dateModified、可见 "Updated" 行、manifest、STATIC_SITEMAP_ENTRIES(测试强制五处一致)。
- **验证**:重跑 citability_scorer,目标 docs/faq 平均分 41.5 → ≥55 且 F 块清零。

### RUNBOOK部署后手动步骤(文档化,`docs/seo-index-runbook.md`)
1. GSC:Sitemaps 重新提交 `https://octocounts.com/sitemap.xml`(现为 index);对 24 核心页 + 重点对比页用 URL 检查请求编入索引;2–4 周后核对"页面索引"报告(目标:核心/对比子片收录率显著高于报告子片)。
2. Bing Webmaster:确认站点已验证(仓库无 msvalidate meta,应为 DNS 验证);提交 sitemap;跑 `node scripts/resubmit-urls-indexnow.mjs --verify-key` 与 `--core`。
3. 线上验证 curl 清单(文档内给出命令):index/子片 200、无 llms 条目、GSC/Bing 抓取 UA 抽查 SSR。

### 不做 / 遗留
- SG-08 其余生产验证、SG-10 测量基线:需要 GSC/Bing/umami 后台权限,照旧遗留(runbook 已给步骤)。
- 品牌提及(Reddit/YouTube/Wikipedia)、报告页 F 段落程序化强化:中长期,另行排期。

## 三、风险与回滚
- 全部改动集中在 frontend function/tests/public 静态资产与 scripts,不触碰后端与数据。
- 回滚 = revert 单个 commit;robots.txt 与 URL 结构不变,GSC 无需改配置。

## 四、实施记录与验证结果(2026-09-19,全部本地验证通过)

| 项 | 结果 |
|---|---|
| FIX-1/2 sitemap 拆分 + llms 移出 | ✅ `functions/[[path]].js` 重构为 index + 3 子片(报告片 ≤10,000/片);删除被遮蔽的 `public/sitemap.xml`;robots.txt 不变 |
| 测试 | ✅ `frontend npm test` 全绿:unit 4/4 + product-facts + seo **77/77**(含新增的 index 结构、llms 排除、越界片空 urlset、Trending lastmod 注入断言) |
| FIX-4/5 IndexNow | ✅ `--verify-key` / `--core` 实现并补测,`scripts/resubmit-urls-indexnow.test.mjs` **8/8**;部署文档已补用法 |
| FIX-6 FAQ 强化 | ✅ 11 个弱答案扩为自包含答案块,HTML/markdown/FAQPage JSON-LD 三处同步;manifest 与 STATIC_SITEMAP_ENTRIES 日期同步 2026-09-19 |
| 可引用性复测 | ✅ docs/faq 平均分 **41.5 → 51.1**,F 级段落 **9 → 0**(C 级 4→14)。未达 55 的原因:统计密度维度需要真实百分比/数字,站内无更多可诚实引用的数据,拒绝编造 |
| RUNBOOK | ✅ `docs/seo-index-runbook.md`(部署后 curl 验证、IndexNow 命令、GSC/Bing 步骤、2 周观察指标、回滚) |

线上生效条件:部署本次前端改动后,执行 runbook 第 1 节的 curl 验证;GSC/Bing 手动步骤见第 3、4 节。

### 遗留(非本轮)
- FIX-3(报告页 lastmod 语义)按计划不改,理由见上。
- SG-08 其余生产验证、SG-10 测量基线:需要 GSC/Bing/umami 权限。
- 品牌提及(Reddit/YouTube/Wikipedia)、报告页/对比页程序化段落的可引用性强化:中长期。
