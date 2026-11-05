# SEO 收录修复部署手册(Runbook)

> 配套计划:[seo-geo-plan-2026-09-19.md](seo-geo-plan-2026-09-19.md)。本手册是 sitemap 拆分 + llms 移出 sitemap + FAQ 强化上线后的**必须手动步骤**与验证清单。GSC/Bing Webmaster 需要账号权限,无法从仓库自动化(SG-10 遗留)。

更新：2026-11-05。URL 数量以当次线上 sitemap 为准；下列检查不代表已经部署、提交或收录。

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

# 先看会推什么(不实际发送)
INDEXNOW_KEY=<key> DRY_RUN=1 node scripts/resubmit-urls-indexnow.mjs --core

# 核对 URL 后，推送线上 static/compare sitemap 中的核心页
INDEXNOW_KEY=<key> node scripts/resubmit-urls-indexnow.mjs --core
```

注意:`--core` 依赖线上已部署拆分后的子 sitemap;若 404 会显式报错,不会静默截断。

## 3. Google Search Console(需账号)

1. **Sitemaps**:重新提交 `https://octocounts.com/sitemap.xml`。GSC 会展开显示 static、compare 和按数据量分页的 reports 子 sitemap；不要把发现的 URL 数当作收录数。
2. **URL 检查**:对以下页面逐个"请求编入索引"(每 天有配额,优先级从上到下):
   - `/`(核对当前收录状态)
   - `/docs/faq`(部署本轮内容更新后检查)
   - `/compare/react-vs-vue`、`/compare/rust-vs-go`、`/compare/nextjs-vs-vite` 等头部对比页
   - `/research`、`/docs/best-sloc-counter-tools`、`/docs/github-sloc-counter`
3. **2–4 周后核对**「索引 → 页面」报告:
   - 分别记录 static、compare、reports 页组的收录数、未收录原因及样本 URL，与部署前同口径基线比较；
   - 对“已发现/已抓取但未编入索引”的样本检查内容价值、重复页、canonical、响应状态和渲染后正文；不要仅因它是程序化页面就忽略；
   - 未取得后台数据时标注 unknown，不假设对比页从 0 开始，也不承诺固定收录率。
4. 若此前有旧 sitemap 提交记录指向 `/sitemap.xml`,无需删除(同一 URL 现在返回 index)。

## 4. Bing Webmaster Tools(需账号)

1. 确认 `octocounts.com` 已验证。仓库中没有 `msvalidate.01` meta,若未验证,用 DNS TXT/CNAME 方式(不要往页面加 meta,避免多一处维护)。
2. **提交站点地图**:`https://octocounts.com/sitemap.xml`。
3. 跑第 2 节的 `--verify-key` 与 `--core`。
4. 用「URL 检查」核对首页与 3–5 个核心页并按需请求索引。Bing 收录和 IndexNow 接收均不保证 ChatGPT 或其他 AI 系统引用。
5. 2–4 周后在「Site Explorer / URL 检查」看核心页收录状态。

## 5. 效果观察指标(建议每 2 周)

| 指标 | 来源 | 期望方向 |
|---|---|---|
| 各页组收录数、未收录原因、Google 选择的 canonical | GSC 页面报告 / URL 检查 | 比较同口径基线，优先修复错误与不一致 |
| 核心子片 vs 报告子片的收录比例 | GSC 页面报告，按 sitemap 筛选 | 记录分子与分母；不设没有历史依据的阈值 |
| 各页组曝光、点击、CTR、查询 | GSC 效果报告 | 比较等长 28 天窗口，注明发布与季节因素 |
| Google 生成式 AI 曝光（按页/国家/设备） | GSC Generative AI performance（若属性有该报告） | 单独比较 AI 曝光；缺失报告不当作零，不与 Web 总曝光相加 |
| 自然搜索及可识别 AI 来源的访问、分析完成、商店点击 | umami | 区分访问、使用和商店点击；点击不是安装 |
| 固定提示词集的品牌提及率与带链接引用率 | ChatGPT/Perplexity 等实际搜索回答 | 同平台/语言重复采样，记录次数、日期与回答证据 |

`site:` 仅用于查找样例，不能作为完整收录数量或收录率；[Google 明确说明结果不一定完整](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site)。具体事件定义和采样模板见 [SEO/GEO 测量规范](seo-geo-measurement.md)。

## 6. 回滚

全部改动为前端静态资产/边缘函数/脚本,revert 对应 commit 即可。robots.txt 的 Sitemap 行未变,GSC/Bing 配置无需回滚。
