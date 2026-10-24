# Findings — PathSeek

- Plan ID: pathseek-development
- Checkpoint ID: pathseek-20261024-review-02
- Last Updated: 2026-10-24T08:45:49.982Z
- Repository: juezhong/raycast-pathseek
- Evidence: [首轮 Code Review](../../docs/reviews/2026-10-24-initial-code-review.md) · [质量 Issue #4](https://github.com/juezhong/raycast-pathseek/issues/4) · [Draft PR #3](https://github.com/juezhong/raycast-pathseek/pull/3)

## 已确认的用户需求与技术决策
1. 目标是 Listary 风格的 **独立全局文件/目录搜索 + Finder 操作 + 原应用 Open/Save 对话框原位导航**，不是只把路径显示到 Finder。
2. 搜索架构为 **fd 建立插件自有持久化索引 + fzf 模糊匹配 + 正则表达式路径匹配**。不使用 Raycast 私有搜索索引，不在每个搜索字符上执行 fd。
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
