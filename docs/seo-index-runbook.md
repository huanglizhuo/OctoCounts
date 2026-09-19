# SEO 收录修复部署手册(Runbook)

> 配套计划:[seo-geo-plan-2026-09-19.md](seo-geo-plan-2026-09-19.md)。本手册是 sitemap 拆分 + llms 移出 sitemap + FAQ 强化上线后的**必须手动步骤**与验证清单。GSC/Bing Webmaster 需要账号权限,无法从仓库自动化(SG-10 遗留)。

## 1. 部署后立即验证(无需任何账号)

```sh
# sitemap index 结构正确(应列出 sitemap-static/compare/reports-1)
curl -s https://octocounts.com/sitemap.xml | head -20

# 三个子 sitemap 均 200,且内容归属正确
curl -s -o /dev/null -w "static: %{http_code}\n"  https://octocounts.com/sitemap-static.xml
curl -s -o /dev/null -w "compare: %{http_code}\n" https://octocounts.com/sitemap-compare.xml
curl -s -o /dev/null -w "reports: %{http_code}\n"  https://octocounts.com/sitemap-reports-1.xml

# 任何 sitemap XML 中都不得再出现 llms 条目(应无输出)
curl -s https://octocounts.com/sitemap-static.xml  | grep -c llms || true
curl -s https://octocounts.com/sitemap-compare.xml | grep -c llms || true

# 爬虫 UA 抽查 SSR(应 200 且 title 含 "source lines of code" 或具体仓库名)
curl -s -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  https://octocounts.com/compare/react-vs-vue | grep -o '<title>[^<]*</title>'
curl -s -A "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" \
  https://octocounts.com/docs/faq | grep -o '<title>[^<]*</title>'
```

## 2. IndexNow(Bing 及其他 IndexNow 引擎)

`INDEXNOW_KEY` 必须与 Cloudflare Pages 环境变量一致(边缘函数靠它应答 `/{key}.txt`)。

```sh
# 验证 key 文件可达且内容一致(退出码 0 = 通过)
INDEXNOW_KEY=<key> node scripts/resubmit-urls-indexnow.mjs --verify-key

# 主动推送核心页(24 静态页 + 101 对比页)加速 Bing 发现/重抓
INDEXNOW_KEY=<key> node scripts/resubmit-urls-indexnow.mjs --core

# 先看会推什么(不实际发送)
INDEXNOW_KEY=<key> DRY_RUN=1 node scripts/resubmit-urls-indexnow.mjs --core
```

注意:`--core` 依赖线上已部署拆分后的子 sitemap;若 404 会显式报错,不会静默截断。

## 3. Google Search Console(需账号)

1. **Sitemaps**:重新提交 `https://octocounts.com/sitemap.xml`。现在是 sitemap index,GSC 会展开显示三个子 sitemap 及各自已发现 URL 数。
2. **URL 检查**:对以下页面逐个"请求编入索引"(每 天有配额,优先级从上到下):
   - `/`(确认仍已收录)
   - `/docs/faq`(内容刚更新)
   - `/compare/react-vs-vue`、`/compare/rust-vs-go`、`/compare/nextjs-vs-vite` 等头部对比页
   - `/research`、`/docs/best-sloc-counter-tools`、`/docs/github-sloc-counter`
3. **2–4 周后核对**「索引 → 页面」报告:
   - `sitemap-static.xml` 与 `sitemap-compare.xml` 的收录率应显著高于 `sitemap-reports-1.xml`;
   - 对比页从 0 收录开始增长;
   - 报告子片的 "Discovered - currently not indexed" 属预期(程序化页面,Google 择优收录),不再影响核心页。
4. 若此前有旧 sitemap 提交记录指向 `/sitemap.xml`,无需删除(同一 URL 现在返回 index)。

## 4. Bing Webmaster Tools(需账号)

1. 确认 `octocounts.com` 已验证。仓库中没有 `msvalidate.01` meta,若未验证,用 DNS TXT/CNAME 方式(不要往页面加 meta,避免多一处维护)。
2. **提交站点地图**:`https://octocounts.com/sitemap.xml`。
3. 跑第 2 节的 `--verify-key` 与 `--core`。
4. 用「URL 检查」对首页与 3–5 个核心页请求索引(Bing 的索引同时喂给 ChatGPT 检索,是 GEO 的一部分)。
5. 2–4 周后在「Site Explorer / URL 检查」看核心页收录状态。

## 5. 效果观察指标(建议每 2 周)

| 指标 | 来源 | 期望方向 |
|---|---|---|
| `site:octocounts.com/compare` 结果数 | Google/Bing | 从 0 开始增长 |
| docs 页收录数(8 页) | GSC 页面报告 | 全部已编入索引 |
| 核心子片 vs 报告子片收录率 | GSC sitemap 报告 | 核心 > 80%,报告片预期低 |
| umami 自然搜索会话 | umami | 上升 |
| 10 个目标提示词的 AI 引用 | ChatGPT/Perplexity 手测 | 出现 OctoCounts 引用 |

## 6. 回滚

全部改动为前端静态资产/边缘函数/脚本,revert 对应 commit 即可。robots.txt 的 Sitemap 行未变,GSC/Bing 配置无需回滚。
