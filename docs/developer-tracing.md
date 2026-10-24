# PathSeek 开发者调用追踪（fd / fzf）

> 适用于 Draft PR #3（尚未合并 main）。目标是查看 fd/fzf 是否启动、为什么启动、如何调用、耗时和结果，而不增加普通用户的搜索负担。

## 开启与查看

在 Raycast → Extensions → PathSeek → Preferences 开启 **Developer: Trace fd/fzf Calls**。默认是 **Off**；关闭时不创建追踪文件，也不执行额外的磁盘读取或写入。修改后建议重新打开搜索命令。

打开选项后，执行 **Rebuild Index** 或在 **Search Files** 输入搜索词。随后打开 **Debug Info**，查看「fd/fzf 调用记录（开发者选项）」。已打开的 Debug Info 可以通过 Action → **Refresh Diagnostics** 手动刷新。Action → **Copy Sanitized Debug Info** 可复制完整脱敏报告。

## 何时调用

| 工具 | 调用时机 | 触发原因（reason） | 调用方式 |
| --- | --- | --- | --- |
| fd | 显式 Rebuild Index | manual-rebuild | Node.js child_process.spawn，参数含 --absolute-path --print0、可选 --hidden / --follow / --exclude |
| fd | 15 天到期后再次打开 Search Files | 15-day-refresh | 同上，依据用户搜索根目录构建索引 |
| fzf | Search Files 输入非空查询、防抖后 | fuzzy-query | Node.js child_process.spawn，--extended --read0 --print0 --filter，数据来自持久化索引 |


**输入搜索词本身不允许触发 fd。** 只有手动重建和 15 天按需刷新可以调用 fd。15 天按需刷新可能在打开搜索命令后启动，但不会每个键盘输入都启动。所有查询都通过 fzf。

## 追踪格式

每次实际调用产生一条 start 记录和一条 end 记录（若进程被强制结束，end 可能缺失）。记录字段：

- at：时间（ISO 8601）
- tool：fd/fzf
- phase：start/end
- reason：manual-rebuild、15-day-refresh、fuzzy-query
- invocation：脱敏参数结构，不含真实扫描根目录和查询词
- outcome：success/limit-reached/failure/cancelled
- durationMs：毫秒
- resultCount：扫描条目数或匹配数
- exitCode：子进程退出码，信号终止时可能为空
- errorCode：经过白名单过滤的系统错误码，不保存 stderr

示例（模拟数据，不是 Mac 实测）：

```text
2026-10-24T09:00:00Z | fd | manual-rebuild | fd --absolute-path --print0 . <root> | started
2026-10-24T09:00:01Z | fd | manual-rebuild | fd --absolute-path --print0 . <root> | success, 832ms, results=2048, exit=0
2026-10-24T09:01:00Z | fzf | fuzzy-query | fzf --extended --read0 --print0 --filter <redacted> | started
2026-10-24T09:01:00Z | fzf | fuzzy-query | fzf --extended --read0 --print0 --filter <redacted> | success, 26ms, results=19, exit=0
```

达到最多 150 条匹配结果后，fzf 可能被主动发出终止信号，诊断应显示 **limit-reached, results=150, exit=null**。这属于正常截断，不是搜索失败。

只有 start 而没有 end 的记录表示「发生过启动尝试」，**不能断定进程仍在运行**；它也可能已因 Raycast 退出而终止。

## 隐私、存储、性能

追踪仅存于当前 Raycast extension 的 environment.supportPath：
- command-trace.jsonl：最新日志
- command-trace.previous.jsonl：前一次轮换日志

每份达到约 256 KiB 后尝试轮换，Debug Info 最多展示最近 50 条事件。多进程并发写入可能出现个别事件缺失，诊断日志不是事务日志，不能替代原子索引正确性设计。

**永不记录真实绝对路径、文件名、搜索词、排除表达式原值、二进制安装路径或 stderr 全文。** 如要把 Debug Info 粘贴到公开 GitHub Issue，仍建议先预览。

开启追踪会在每次调用时额外写入事件（轻微 CPU 和磁盘开销）；只建议在排障和性能检查时打开。关闭时无额外磁盘诊断开销，也不启动额外扫描。

## 验收建议

- 关闭追踪：正常 Fuzzy 搜索，没有新的追踪文件写入
- 开启后手动重建：出现 fd start/end 与结果数
- 15 天未到期时连续搜索：不出现 fd start
- Search Files 输入搜索词：出现 fzf start/end，能够看到耗时、结果数与退出状态
- 模拟失败/取消：不泄露真实路径，索引及搜索功能不受诊断异常影响
- 通过 Refresh Diagnostics 在已有 Debug Info 窗口查看新数据

开发任务：[Issue #5](https://github.com/juezhong/raycast-pathseek/issues/5)。代码：[PR #3](https://github.com/juezhong/raycast-pathseek/pull/3)。
