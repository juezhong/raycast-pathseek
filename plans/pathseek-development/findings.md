# Findings — PathSeek

- Plan ID: pathseek-development
- Checkpoint ID: pathseek-20261024-fzf-only-06
- Last Updated: 2026-10-24
- Repository: juezhong/raycast-pathseek
- Evidence: [首轮 Code Review](../../docs/reviews/2026-10-24-initial-code-review.md) · [质量 Issue #4](https://github.com/juezhong/raycast-pathseek/issues/4) · [Draft PR #3](https://github.com/juezhong/raycast-pathseek/pull/3)

## 已确认的用户需求与技术决策
1. 目标是 Listary 风格的 **独立全局文件/目录搜索 + Finder 操作 + 原应用 Open/Save 对话框原位导航**，不是只把路径显示到 Finder。
2. 当前最新决策：**fd 建立插件自有持久化索引 + fzf-only 统一搜索**；先前的独立 Regex 为历史版本设计，已在 PR #3 删除。不使用 Raycast 私有搜索索引，不在每个搜索字符上执行 fd。
3. 首次显式 Rebuild Index；自上次成功构建满 **15 天后，下一次打开 Search Files** 时尝试按需更新；手动重建始终允许。没有常驻后台定时服务，不能保证关闭 Raycast 时准时刷新。
4. 当前实现将索引放在 `environment.supportPath`，索引包含用户私人绝对路径，禁止上传至 GitHub。支持自定义根目录、隐藏文件开关、排除 glob、跟随符号链接。
5. 结果提供原生 Finder 文件类型图标、Open、Show in Finder、Open With、Copy Path、Quick Look；未来增加类型过滤与失效路径提示。
6. 对话框集成必须返回原应用已有 Open/Save 面板，不能弹出额外 Finder；未经用户确认不能自动提交 Save。
7. 项目开源许可证 MIT；参考 Fuzzy File Search 的 UI / fd/fzf 设计，保留版权和第三方归属；Raycast Store 发布仍需审核。

## 实际已检查的代码与证据
- `main`：`src/lib/index-store.ts`、`src/lib/fuzzy-search.ts`、`src/lib/regex-search.ts`、`src/search-files.tsx`、`src/rebuild-index.tsx`、`src/index-status.tsx`、`package.json`。
- Draft PR #3 分支：`src/lib/index-files.ts`、`src/lib/index-store.ts`、`tests/index-files.test.mjs`、`.github/workflows/index-lifecycle.yml`。
- Issue #1 近期状态：**5 项勾选通过，9 项待验收**。用户在评论中报告过 `ENOENT`，随后反馈旧报错已修复；两个 `.nul` 文件在旧版中是禁用历史清理后的结果。
- Issue #2：**17 项暂未勾选**（15 天更新、Regex、图标等）——实现提交不代表已通过实机测试。
- PR #3 macOS GitHub Actions `Index lifecycle tests`：已返回 `completed / success`；**不等于** `npm run build`、`npm run lint`、Raycast GUI 测试通过。
- 三份计划文件截至本轮依然是 `pathseek-20261024-01`：此前的 Planning with Files 检查点没有按实际开发推进更新，本轮正在纠正。
- 详细审查：[`docs/reviews/2026-10-24-initial-code-review.md`](../../docs/reviews/2026-10-24-initial-code-review.md)。

## Code Review 发现和风险
| ID | 优先级 | 结论 | 定位与修复方向 |
| --- | --- | --- | --- |
| CR-01 | **P0 / PR3 blocker** | PR3 固定 `index.nul` 后，索引文件和元数据仍分两次 rename；中途失败可能出现新数据+旧时间/数量 | 在 PR3 改进提交/恢复协议，增加注入测试 |
| CR-02 | P1 | main 旧 UUID 文件清理可造成读者持旧路径访问 ENOENT；写锁不能保护读者 | PR3 固定路径 + 原子替换方向正确，待合并验证 |
| CR-03 | P1 | 15 天更新由 Raycast UI Effect 触发，退出 UI 可能中断建索引 | 澄清生命周期、异常清理和可验证执行机制 |
| CR-04 | P1 | auto-refresh 的 `lastAttempt` 在拿锁/扫描前写入，锁忙或中断也可能被压制 24 小时 | 分离“锁忙”“真正失败”和重试退避 |
| CR-05 | P1 | JavaScript RegExp 在扩展主线程逐个匹配路径，256 字符限长不能防灾难性回溯 | 进程隔离/安全正则引擎、超时和极端案例测试 |
| CR-06 | P1 | PR3 CI 仅跑 index-files 辅助函数 `npm test`，没有 lint/build、lockfile 和端到端集成 | 扩展 CI 与故障注入测试 |
| CR-07 | P2 | 中断时的残留临时文件、输出格式及文件数一致性检查不足 | 增加安全清理和诊断统计 |
| CR-08 | P2 | 文件/目录过滤尚未实现，旧索引路径已删除时 Finder Actions 无明确提示 | 增加类型元信息/筛选及存在性校验 |
| CR-09 | P2 | 规划文档滞后，风险/验收/状态与当前代码不一致 | 本轮恢复计划检查点，后续约定更新频率 |

## 重大设计澄清
- **两个索引文件不是锁问题的证据**。旧版每次构建随机 UUID 路径，取消旧文件清理后自然累积。
- **固定正式索引 `index.nul` + 原子 rename** 是解决旧 UUID 读路径失效的主要方式；保留写锁仅用于防止两个写者交错，不是读者安全的前提。
- `index.nul` 替换与 `index.json` 替换仍非单次原子事务，需考虑崩溃恢复。
- 15 天更新不是定时后台任务，也不保证 UI 退出后能完成；应把边界说明清楚。
- Regex 是路径搜索不是文件内容搜索，输入正则属于用户控制的性能风险面。

## 未验证与安全边界
- 目前没有完成本轮的 macOS `npm run build`、`npm run lint`、全文搜索性能实测、对话框测试。
- PR3 CI 成功仅表明当前 index helper 的已覆盖测试通过。
- 用户本地绝对路径、索引原文件、日志敏感信息不得写入公开 GitHub。
- 本次计划文件仅按用户要求手动保存（`manual_save`）。技能支持 `continuous_checkpoints`，但只有用户对**指定三个计划文件**明确持续授权后才能开启；无平台后台 Hook。

## Next Step
在 Draft PR #3（fix/stable-index-file-atomic-swap）中修复 CR-01：为 index.nul 与 index.json 的分步发布设计可恢复提交协议，添加“数据发布成功而元数据发布失败”的故障注入测试；完善 npm run build/lint 的 CI 门槛，验证后再决定是否合并 PR。


## 2026-10-24 — CR-01 质量门槛修复方案落地（Draft PR #3，pathseek-20261024-pr3-v2-03）

- 发现原双文件协议（先 index.nul，再 index.json）存在数据与元信息分步提交导致的崩溃一致性缺陷；现在 PR #3 已改用**v2 单文件封装**。
- 格式为 8 字节 `PSIDX002` + 4 字节小端 JSON 长度 + UTF-8 元数据 JSON（version/createdAt/count/roots）+ NUL 分隔的绝对路径。
- `src/lib/index-files.ts` 把封装文件在临时位置构建并校验路径数量、末尾 NUL 和字节数，随后一次 `rename` 替换 `index.nul`；新读者使用 `openIndexDataStream()` 从**同一个已打开的句柄**解析头部和读取路径，避免重建更改头部长度导致偏移错用。
- `src/lib/index-store.ts` 优先读取 v2；没有 v2 时兼容旧 `index.json + index-UUID.nul`。旧 UUID 文件允许至少 24 小时迁移宽限。v2 不再需要单独提交 index.json。
- Debug Info、Index Status、中英文 README、`docs/index-storage.md` 已在 PR 分支配合更新；`main` 尚未合并这些实现。
- GitHub Actions **确证**：`npm install` 成功；`npm test` **7/7 通过**；`npx tsc --noEmit` 通过。完整 `ray lint` 未通过、`ray build` 未执行，不能宣称 PR 就绪。
- lint 阻塞：Raycast 官方接口找不到 manifest 作者 `juezhong`（该值是 GitHub 用户名，未证明是 Raycast 账号）；代码需经 Prettier 格式化。Raycast 作者名需要用户确认，不能猜测。
- 自描述索引消除了索引与元数据双文件原子性问题；本轮尚未完成真实 fd 集成、UI 生命周期、极端崩溃/断电的持久化测试，`CR-03/04/05/07/08` 仍待处理。
- 详细进展：[PR #3 的实现与 CI 说明](https://github.com/juezhong/raycast-pathseek/pull/3#issuecomment-6382347272)。

## Next Step
确认正确的 Raycast 账户用户名（当前 package.json author=juezhong 被官方校验返回 404），据此修正 PR #3 的 manifest；随后修复 Prettier 格式并重新运行 macOS CI 的 lint/build。

## 2026-10-24 — 开发检查与商店发布检查分离

- 经仓库维护者确认：`package.json.author` 对应的 Raycast Store 用户名**在正式发布前再填写**；开发阶段保留现值，不猜测或借用第三方用户名。
- [Draft PR #3](https://github.com/juezhong/raycast-pathseek/pull/3) 已添加 `lint:code`、`format`、`format:check` 脚本，把源码 ESLint 与完整 Raycast Store lint 分开。
- macOS GitHub Actions 已确认 `npm install`、`npm test` 7/7、`npx tsc --noEmit`、`npm run lint:code`、`npm run build` **全部通过**。
- 完整 `npm run lint` 在 CI 中标注为**非阻塞发布审查项**：仍会显示 `author` 404 和 Prettier 格式错误，故不得误报“Raycast Store lint 通过”。详细情况在 [PR 评论](https://github.com/juezhong/raycast-pathseek/pull/3#issuecomment-6382410366)。
- 质量说明：新自描述 v2 单文件索引、旧版兼容逻辑通过代码构建与辅助函数单测，但尚未完成 macOS GUI 实测、实际 `fd` 长目录构建性能或 FSEvents/对话框交互测试。

## 2026-10-24 — 默认关闭的 fd/fzf 开发者追踪（pathseek-20261024-debug-trace-05）

- 用户提出必须可见 fd/fzf **何时运行、由什么触发、参数形式、执行状态、耗时、结果数量**；日常用户不应因诊断拖慢搜索。
- 已在 [Draft PR #3](https://github.com/juezhong/raycast-pathseek/pull/3) 的 `fix/stable-index-file-atomic-swap` 分支实现 `src/lib/command-trace.ts` 和 `enableCommandTracing` 配置：**默认 false**。
- fd 只在手动 Rebuild Index（manual-rebuild）或 15 天到期按需更新（15-day-refresh）时由 child_process.spawn 启动；fzf 只在 Fuzzy 查询（fuzzy-query）时 spawn。Regex 搜索不调用 fzf。
- 开启开发者追踪后，fd/fzf 记录 start/end、触发原因、脱敏的参数形式、耗时、条目/匹配数量、退出状态、错误代码；Debug Info 显示最近 50 条记录并可刷新或复制脱敏报告。
- 日志存 `environment.supportPath/command-trace.jsonl`，达到约 256KiB 后轮换到 previous。绝不写搜索词、用户绝对路径、扫描根目录、排除规则原文、完整 stderr。关闭后无额外诊断磁盘 I/O，仅检查设置布尔值；开启可能增加轻微 I/O。
- [docs/developer-tracing.md](https://github.com/juezhong/raycast-pathseek/blob/fix/stable-index-file-atomic-swap/docs/developer-tracing.md) 与 [Issue #5](https://github.com/juezhong/raycast-pathseek/issues/5) 已创建。
- 最新 PR #3 的 GitHub Actions 已确认 **completed/success**，包括 7 个索引单测、TypeScript、源码 ESLint 和 Raycast build。完整 Raycast Store lint 作为非阻塞审核步骤，作者用户名与 Prettier 仍未达发布要求。
- **仍需 Mac 实测**：确认日志在追踪关闭时没有写入、快速输入时 fzf 取消状态可解释、没有意外 fd 调用以及 v1→v2 迁移正确。

## Current Next Step (checkpoint pathseek-20261024-debug-trace-05)
在 Mac 上从 Draft PR #3 独立工作目录加载扩展，验证 v1→v2 索引迁移、搜索与重建并发，以及开发者 fd/fzf 追踪的默认关闭/开启行为；到 Issue #5 和 PR #3 提交实测结果，再决定 Ready for Review / 合并。

## 2026-10-24 — 搜索方案收敛为 fzf-only（pathseek-20261024-fzf-only-06）

- 用户已经对 PR #3 的初版功能做了本地测试并表示可以使用；具体的成功/失败项目以 [Issue #2](https://github.com/juezhong/raycast-pathseek/issues/2)（之前 6 项已通过）及 [Issue #5](https://github.com/juezhong/raycast-pathseek/issues/5)（之前 4 项通过）的实时勾选为准，不推定所有场景通过。
- 用户明确决定**取消独立 Regex 搜索，统一使用 fzf**；fzf **不支持完整正则表达式**，但有内建扩展搜索：普通模糊、`'report` 精确包含、`.pdf$` 后缀、`!node_modules` 排除以及 `.ts$ | .tsx$` OR。官方语法：https://junegunn.github.io/fzf/search-syntax/
- Draft PR #3 已删除 `src/lib/regex-search.ts`，Search Files 不再有 Fuzzy/Regex 切换菜单，所有查询统一调用 `fuzzySearch()`，并给 fzf 显式增加 `--extended`。
- **CR-05 原 JavaScript Regex 主线程灾难性回溯风险已通过移除功能消除**；这是范围变化，不是单独 Regex 防护功能验证通过。
- 单一 fzf 仍读取已有自描述 v2 索引；普通用户输入查询不启动 fd；手动重建和 15 天过期时的下次 Search Files 启动才可能运行 fd。
- 中英文 README、架构、开发、索引和调用追踪文档均同步；Issue #2（fzf 搜索）与 Issue #4（移除已撤销 Regex 修复项）、Issue #5（日志验收）已更新。
- 以上变更只写到 PR #3 分支 **fix/stable-index-file-atomic-swap**，`main` 仍保留旧 Regex 代码直至 PR 合并；不得让用户以为 `git pull main` 已获得更新。
- GitHub Actions 对最新 PR3 commit 返回 completed/success；仅为开发期测试/tsc/源码 lint/build，不含完整发布 Store lint 和 macOS 用户对**最新 fzf-only 改动**的手动测试。

## Latest Next Step (pathseek-20261024-fzf-only-06)
请维护者继续在 Mac 上用 Draft PR #3 独立 worktree 验收单一 fzf 搜索（含 .pdf$、'report、!node_modules、OR）、fd/fzf 调用追踪和索引重建；根据 Issue #2 / #5 实测与剩余 Code Review 风险决定 PR #3 是否 Ready / 合并。
