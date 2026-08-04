# OctoCounts Backend 性能优化实施计划

分支：`perf/backend-optimizations`
测试库：`postgres://postgres:postgres@127.0.0.1:55432/octocounts_test`（容器 `octocounts-test-pg`，一次性，可随时销毁）

> **绝对不要使用 `.env` 里的 `DATABASE_URL`** —— 那是 Neon 生产库。
> 所有测试一律通过 `TEST_DATABASE_URL` 指向上面的本地容器。

## 通用规则

每一项优化独立完成、独立验证、独立 commit：

1. 改代码
2. `cargo build --release` 必须通过，且不引入新 warning
3. `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/octocounts_test cargo test` 全绿
4. 涉及行为变化的，补/改单元测试
5. `git commit`，message 格式见下

```
perf(backend): <一句话说明改了什么>

<为什么快了，量级估计>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## 批次 A — 快速收益（文件：`Cargo.toml` / `main.rs` / `og.rs` / `badge.rs` / `cache.rs`）

### A1. OG 字体只加载一次
- **现状**：`og.rs:69` 每个 `/og/...` 请求都调 `options.fontdb_mut().load_system_fonts()`，扫描整个 `/usr/share/fonts` 并解析每个字体文件。
- **做法**：把 `fontdb::Database` 放进 `OnceLock<Arc<fontdb::Database>>`，构造 `usvg::Options` 时用 `Arc::clone` 复用。进一步可以 `include_bytes!` 内嵌 DejaVu Sans Mono 后用 `load_font_data` 替代 `load_system_fonts`，这样容器就不再依赖 `fonts-dejavu-core` + `fontconfig`（Dockerfile 可同步精简）。
- **验证**：新增测试断言连续两次 `render_png` 都成功且输出字节一致；用 `Instant` 粗测第二次调用远快于第一次（不写进断言，只在 commit message 里记录实测数字）。

### A2. 开启响应压缩
- **现状**：`main.rs:88` 只有 `CorsLayer` + `TraceLayer`；`Cargo.toml` 的 `tower-http` features 是 `["cors", "trace"]`。
- **做法**：features 加 `compression-br`、`compression-gzip`，router 上挂 `CompressionLayer::new()`。注意层序：压缩层要在 `TraceLayer` 之内、`CorsLayer` 之外，别把已经是 PNG 的 OG 图重复压（`CompressionLayer` 默认按 content-type 判断，确认 `image/png` 不会被压）。
- **验证**：集成测试用 `tower::ServiceExt::oneshot` 带 `accept-encoding: gzip` 打 `/api/stats`，断言响应带 `content-encoding: gzip`；再打一次不带该 header，断言未压缩。

### A3. release profile 调优
- **现状**：`Cargo.toml` 没有 `[profile.release]`。
- **做法**：加 `lto = "fat"`、`codegen-units = 1`、`panic = "abort"`。若 `panic = "abort"` 与测试冲突（测试需要 unwind），只在 `[profile.release]` 设，`[profile.test]` 保持默认。
- **验证**：`cargo build --release` 通过并记录构建耗时变化；`cargo test` 全绿。

### A4. OG 光栅化移出 async 线程
- **现状**：`og.rs:65` 的 `render_png`（resvg 渲染 1200×630 + PNG 编码）在 async handler 里同步执行，阻塞 tokio worker。
- **做法**：包进 `tokio::task::spawn_blocking`。
- **验证**：现有 OG 测试仍通过；handler 签名变化后编译通过。

### A5. OG PNG 与徽章 SVG 加内存缓存
- **现状**：`AppCaches` 已有 moka 基础设施，但 OG 和 badge 完全没走缓存，每次都打 DB。
- **做法**：在 `cache.rs` 加两个 cache：
  - `og_png: Cache<String, Bytes>`，key = `provider:owner:repo:commit_sha`，容量 ~500，TTL 24h
  - `badge_svg: Cache<String, String>`，key = `owner:repo:ref:badge_type:lang`，容量 ~2000，TTL 5min（`is_immutable` 的 tag/commit 徽章可以用更长 TTL）
  - 注意 pending / error 状态的徽章**不要**缓存。
- **验证**：单元测试断言同 key 第二次命中缓存（可通过 mock store 调用计数，或至少断言 cache 插入后 `get` 返回值一致）。

### A6. 换分配器
- **做法**：引入 `mimalloc`（或 `tikv-jemallocator`），在 `main.rs` 设 `#[global_allocator]`。mimalloc 在 macOS/Linux 上都好用，优先选它。
- **验证**：`cargo build --release` + `cargo test` 通过。若引入交叉编译或 musl 问题则回退并记录原因。

---

## 批次 B — 数据库层（文件：`store.rs` / `seo.rs` / `api.rs` / `main.rs` / `config.rs`）

> 这批涉及 schema 变更。所有 DDL 必须写成幂等的（`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`），
> 并遵循 `store.rs` 现有 `migrate()` 的写法风格。**回填老数据必须分批**，不能一条 UPDATE 扫全表。

### B1. 物化统计列 + 索引（其余项的基础，先做）
- **现状**：`distinct_reports`（`store.rs:623`）三个分支都要 `SELECT body::text`，把整份报告 JSON 拉出来再 `serde_json::from_str`，只为用其中几个字段；`monoliths` 的 `ORDER BY total_lines DESC` 是子查询外的表达式，用不上索引。
- **做法**：`reports` 表加列 `total_lines BIGINT`、`total_code BIGINT`、`total_files BIGINT`、`language_count INT`、`top_language TEXT`，在 `save_report` 时写入；`migrate()` 里分批回填历史行（每批 1000，循环到没有 NULL 为止）。为 `(total_lines DESC)`、`(access_count DESC, last_accessed_at DESC)` 建索引。
- **验证**：新增测试：写入报告后断言物化列与 body 内的值一致；回填逻辑对已有 NULL 行生效。

### B2. sitemap 端点不再读 body
- **现状**：`seo.rs:206` 调 `sitemap_reports(45_000)`，走 `distinct_reports` 拉 45000 份完整 JSON 并全部反序列化，实际只用 `provider/owner/repo/generated_at`。
- **做法**：给 store 加一个专门方法，只 `SELECT provider, owner, repo, created_at`，直接构造 `SitemapEntry`，不经过 `Report` 结构体。
- **验证**：测试断言 sitemap 结果条数和 loc 格式与改动前一致（可以先用旧实现跑一遍存为期望值）。

### B3. 列表端点走物化列，不读 body
- **做法**：`recent` / `popular` / `monoliths` 的 SQL 只取 SEO 卡片真正需要的字段（仓库标识 + 物化统计 + 前若干语言）。前 12 个语言可以用 `jsonb_path_query_array` 或 `body->'languages'` 切片在 SQL 侧投影，避免整份 body 过网。
- **验证**：断言改动前后 `/api/seo/recent` 等端点的 JSON 输出完全一致（用现有数据跑 golden test）。

### B4. `/api/reports/{id}` 直通，免去 parse → re-serialize
- **现状**：`store.rs:439` 反序列化成 `Report`，`api.rs:60` 再序列化回 JSON，纯浪费。该端点是 `immutable` 缓存的原样透传。
- **做法**：加一个返回原始 JSON 字符串的 store 方法，handler 直接返回带 `content-type: application/json` 的 `Response`。注意 `cached` 字段的处理逻辑要保持一致。
- **验证**：断言直通路径与旧路径产出的 JSON 语义等价。

### B5. 访问计数合并为单次往返
- **现状**：`store.rs:743` 先 `UPDATE ... RETURNING`（因 1 小时节流，热门报告大概率 0 行），再发一次 `SELECT`，热点路径每次两个 round-trip。
- **做法**：合成一条 CTE（`WITH touched AS (UPDATE ... RETURNING ...) SELECT ... FROM touched UNION ALL SELECT ... WHERE NOT EXISTS`），或改成内存计数器 + 定时批量 flush。**优先选 CTE**，改动小且无状态。
- **验证**：现有节流相关测试必须仍然通过；补测试覆盖「1 小时内重复访问不增加计数」和「超过 1 小时后计数 +1」。

### B6. growth_stats 去掉全表 JSON 展开
- **现状**：`store.rs:510` 用 `LEFT JOIN LATERAL jsonb_array_elements` 对整表展开做 `COUNT(DISTINCT)`，`store.rs:584` 又展开一次；进程内缓存只有 60s TTL，每分钟都要重跑。
- **做法**：新建汇总表 `report_languages(report_id, language, code, lines)`，`save_report` 时同步 upsert（同一事务）；`growth_languages` / `growth_totals` 改查这张表。缓存策略改成 stale-while-revalidate：命中过期值先返回，后台异步刷新，任何请求都不落在冷缓存上。
- **验证**：断言新旧两种实现在同一批测试数据上产出相同的 `GrowthStats`。

### B7. 连接池大小可配置
- **现状**：`main.rs:47` 硬编码 `max_connections(5)`。
- **做法**：走 `Config`，加 `DATABASE_MAX_CONNECTIONS` 环境变量，默认值提到 10，同时设置合理的 `acquire_timeout`。`docker-compose.yml` 和 `.env.example` 同步补上。
- **验证**：编译 + 启动冒烟。

### B8. cleanup 用 reltuples 估算行数
- **现状**：`store.rs:812` 的 `SELECT COUNT(*) FROM reports` 是全表扫描，且发生在持有 advisory lock 的事务里。
- **做法**：改查 `pg_class.reltuples`，仅当估算值接近阈值时才退回精确 `COUNT(*)`。
- **验证**：现有 cleanup 测试全绿（注意小表上 reltuples 可能是 -1 或 0，需要 fallback 分支并覆盖测试）。

---

## 批次 C — 分析主链路（文件：`analyzer.rs` / `github.rs` / `coordinator.rs` / `Cargo.toml`）

> 这批风险最高，务必逐项 commit，每项之间保持可回滚。

### C1. 解压阶段按扩展名过滤（先做，独立且低风险）
- **现状**：`analyzer.rs` 只按目录名（`IGNORED_DIRS`）过滤。图片、字体、压缩包、`*.lock`、minified 产物既写盘又被 tokei 逐行扫描。
- **做法**：在 tar entry 层加扩展名黑名单，直接 `continue`。黑名单要保守——**只排除 tokei 本来就不识别的二进制/资源类型**，绝不能影响任何语言的统计结果。
- **验证**：构造含图片和真实源码的测试 tar，断言统计结果与过滤前完全一致。

### C2. 目录创建去重
- **现状**：`analyzer.rs:101` 每个文件都调一次 `fs::create_dir_all(parent)`，syscall 密集。
- **做法**：用 `HashSet<PathBuf>` 记住已创建的目录。
- **验证**：现有解压测试通过；补一个深层嵌套目录的用例。

### C3. rayon 线程池隔离
- **现状**：tokei 的 `get_statistics` 用 rayon 全局池吃满所有核，外层 `spawn_blocking` 又允许 `ANALYSIS_CONCURRENCY` 个任务并发，两个大仓库同时分析时线程数是核数的两倍。
- **做法**：建独立的 `rayon::ThreadPool`，线程数 = `max(1, 可用核数 / ANALYSIS_CONCURRENCY)`，在其 `install()` 内调 tokei。
- **验证**：并发跑两个分析任务的测试，断言结果正确且无 panic。

### C4. GitHub ref 解析合并为一次 GraphQL 请求
- **现状**：`github.rs:186` 先打 `/repos/{o}/{r}`，再打 `/repos/{o}/{r}/commits/{ref}`，两次串行 RTT。
- **做法**：改用一次 GraphQL 查询同时拿 `isPrivate`、`url`、`defaultBranchRef.target.oid`。**注意 GraphQL API 强制要求 token**，所以必须保留 REST 路径作为无 token 时的 fallback。GitLab 路径不动。
- **验证**：单元测试覆盖 GraphQL 响应解析；无 token 时走 REST 分支的逻辑要有测试。

### C5. `ref_cache` 加 TTL（正确性修复，顺带做）
- **现状**：`github.rs:88` 只设了 `max_capacity(10_000)`，没有 `time_to_live`。分支更新后除非 `force_refresh`，否则永远解析到旧 commit sha。
- **做法**：加 60s 左右的 `time_to_live`。
- **验证**：测试断言 TTL 过期后会重新解析。

### C6. 流式下载 + 边下边解（重头戏）
- **现状**：`github.rs:353` 用 `response.bytes().await` 把最大 2GB 的 tarball 一次性读进内存，读完才开始解压。
- **做法**：`reqwest` 的 `stream` feature 已开启。改用 `bytes_stream()`，通过一个有界的同步管道（`std::io::Read` 适配器 + `tokio::sync::mpsc`，或 `tokio_util::io::StreamReader` + `SyncIoBridge`）喂给 blocking 线程上的 `GzDecoder`。超限检查改成边累计边中断，不再等整包下完才报 `TooLarge`。
- **验证**：端到端测试用一个本地 HTTP server 提供测试 tarball，断言分析结果与旧实现一致；单独测试超限中断路径。

### C7. 免落盘统计 —— **已放弃，不合入**
- **原设想**：在 tar 流里对每个 entry 按文件名推断 `LanguageType`，内容 buffer 直接交给 tokei 解析，完全不落盘，省掉「解压写盘 + tokei 重新 walk 并重读每个文件」的两遍 I/O。
- **实现过并对拍失败**。差分 harness（`analyzer::difftest::real_repositories_are_counted_identically`，拿内存实现与 `count_via_disk` 磁盘 oracle 对比）在 ripgrep 上抓到分歧：

  | | files | code |
  |---|---|---|
  | 内存实现 | 156 | 43,202 |
  | 磁盘 oracle | 162 | 43,844 |

  丢失的正好 6 个文件，全在 `.github/` 下（5 个 YAML + `feature_request.md`），642 行代码。

- **根因比看上去深**。`ignore` crate 的 walk 默认跳过隐藏项，但 ripgrep 根目录有个 `.ignore` 文件，内容是一行 `!/.github/` —— 一条**反选规则**，把 `.github/` 从隐藏规则里重新捞回来。所以正确语义是三层：

  1. 隐藏项默认跳过；
  2. 除非某条 `.ignore`/`.gitignore` 的 `!` 白名单规则把它重新纳入；
  3. 而 ignore 文件在 tar 里的出现顺序**可能晚于它所管辖的条目**，所以必须缓冲候选项，等全部 ignore 文件就位后**回溯重判**。

  单纯去掉隐藏跳过是错的（试过：反而多数出 `.nvim.lua` 和 `.cargo/config.toml` 两个文件）。要做对就得在流式管线里重新实现一遍 `ignore` crate 的目录语义。

- **而且收益存疑**。对拍时实测 ripgrep：流式内存统计 54ms，磁盘 oracle 44ms —— 内存版反而更慢。tokei 的 walk 本身是并行的，而流式管线被 tar 的顺序读串行化了，抵消了省下的 I/O。

- **结论**：复杂度高、正确性风险大、收益未经证实。保留落盘 + tokei walk。C6 的流式下载已经拿走了这条链路上确定的那部分收益（下载与解压重叠、峰值内存降为常数）。
  尝试代码没有合入；差分 harness 留在 `src/analyzer/difftest.rs`，将来若重启此项可直接复用，`count_via_disk` 就是现成的 oracle。

---

## 批次 D — 等待路径（文件：`badge.rs` / `coordinator.rs` / `api.rs` / `store.rs`）

### D1. 任务完成事件通知，取代轮询
- **现状**：`badge.rs:94` 的 `wait_for_job` 先睡 500ms 再查，即使任务早已完成也至少多等 500ms，之后每轮固定 500ms 打一次 DB。
- **做法**：在 `AnalysisCoordinator` 里维护 `HashMap<Uuid, watch::Sender<JobStatus>>`（或 `Notify`），任务完成/失败时直接唤醒同进程的等待者；DB 轮询保留为兜底（间隔可以拉长到 2s，因为主路径已经是事件驱动）。
- **验证**：测试断言任务完成后等待者在远小于 500ms 内被唤醒。

### D2. 徽章轮询退避 —— **未实施，被 D1 取代**
- **原做法**：若 D1 因架构原因不可行，退而求其次：把固定 500ms 改成从 50ms 起的指数退避，且第一次查询前不 sleep。
- D1 顺利落地，本项的前提不成立：「第一次查询前不 sleep」已经由 `await_job` 满足（先注册、立刻查、再等），这本来就是 D2 的主要收益。
- 剩下的只是**兜底轮询**的间隔（现为固定 2s）。而兜底轮询在当前部署下**永远不会真的送达一个完成事件**：`docker-compose.yml` 只有一个 `api` 容器，没有 replica/scale 配置，任务的 worker 与等待者必然同进程，事件一定会发。兜底存在的意义是「将来多副本时不至于卡死」，不是热路径。
- 给一条永不命中的兜底路径加退避（50ms→2s），代价是每个等待中的请求多打约 6 次 DB，换来的是一个当前不存在的拓扑下的延迟改善。
- 还有一个副作用：兜底轮询一旦变快（50ms 起），测试就再也分不清等待者是被**事件**唤醒还是被**轮询**捞到的——D1 那组「远小于 500ms 被唤醒」的断言会全部失去区分度（现在 2s 的间隔让 `a_signal_published_between_the_read_and_the_wait_still_wakes_the_waiter` 在破坏注册顺序时会以 2.007s 失败，非常干净）。
- **结论**：真上多副本时再回来做，届时把间隔改成 50ms 起指数退避即可（只需改 `coordinator.rs` 的 `JOB_POLL_INTERVAL` 一处），并同步给 D1 那组时序测试一个可注入的轮询间隔。

### D3. `/api/jobs/{id}` 支持 long-poll
- **现状**：前端 `useAnalysisRunner.ts:38` 和 `main.tsx:1710` 都在轮询，每次都打 DB。
- **做法**：给该端点加可选的 `?wait=<秒>` 参数，复用 D1 的 watch channel，在任务状态变化或超时时才返回。**保持向后兼容**：不带该参数时行为完全不变，前端可以后续再改。
- **验证**：测试覆盖带 `wait` 与不带 `wait` 两条路径。

---

## 不做的部分（第五档，架构级）

以下建议本次不实施，留作后续讨论：

- 一次解压产出多 profile 报告（复用 per-file 统计结果做多次聚合）
- 热门仓库 tarball 按 sha 落盘缓存
- Dockerfile 依赖层缓存（cargo-chef）—— 只影响构建速度，不影响运行时
- tracing 非阻塞写入 —— 当前 QPS 下收益有限
