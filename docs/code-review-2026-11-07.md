# PathSeek v3 代码审查与合并检查点（2026-11-07）

本次审查覆盖 `src/` 下所有命令和库，重点检查索引生命周期、符号链接、子进程、搜索取消、持久化以及 Open/Save 路径粘贴。对来源不同的结论区分静态代码审查、GitHub macOS CI、用户实机测试三类证据。

## 已发现并修复

| 优先级 | 风险 | 修复/验证 |
| --- | --- | --- |
| P0 | 快速换词时 `fzf` 可能已收到取消，但之前的 Promise 在 child.close 之前返回，导致子进程/输入流尚在运行 | `fzf-runner.ts` 等待 `close`，取消或到达 150 条上限立即停止解压输入；超时默认 60 秒；Mac 子进程测试验证进程退出 |
| P0 | 长时间的 `fd` 扫描在 Build Index 页面退出后没有显式取消入口 | `rebuildIndex(..., signal)` + Build Index 的 **Cancel Index Build**；组件卸载触发 abort，停止当前 fd 与压缩流，并保留旧索引 |
| P1 | 子进程忽略 SIGTERM 时可能继续运行 | 共享 `managed-child.ts` 先发 SIGTERM，宽限期后 SIGKILL；测试使用忽略 SIGTERM 的模拟 fzf 验证升级和回收 |
| P1 | 压缩源流、Brotli 和解码器使用手工 `pipe`，错误/提前销毁传播不对称 | 使用 `pipeline` 传播错误与提前销毁；验证损坏的压缩索引抛错，提前终止 reader 可关闭管道 |
| P1 | 对 11 个软链接依次执行 fd 时同一 `PassThrough` 被反复传给 `pipeline`，积累 Node close 监听器 | 已改为短生命周期 NonClosingSink，Mac 20 次扫描测试无监听器增长；用户已实测告警消失 |
| P2 | 搜索进行中提前显示“没有匹配” | 搜索加载态改为 `Searching Index` |
| P2 | 实机搜索耗时缺少无敏感路径的可复测工具 | `benchmark:search` 输出延迟、命中数及结果上限，不输出文件名、绝对路径或搜索词 |

## 已复核并保留原设计

- 只在明确执行 Build Index 时启动 `fd`，`Search Indexed Files`、View Index Status 和 View Diagnostics 不会触发文件扫描。
- 常规目录永不启用 `--follow`，仅指定的快捷目录下直接子项的目录链接被展开；扫描真实目标后将路径还原到快捷链接路径。
- v3 使用前缀差分 + Brotli，构建流式写入压缩临时索引，成功后 `rename` 原子发布；失败/取消不会覆盖旧索引。
- 旧 v1/v2 格式保留读取能力。搜索使用打开的单一文件描述符，避免切换索引时头/正文不匹配。
- `fzf` 调用使用 `spawn(argv)`，不经过 shell；查询内容不会写入诊断。
- 开发版索引单独保存在 `index-development-v3/` 下，不覆盖正式版的索引。
- 上次实机数据：872,641 条路径，5.07 MiB v3 索引，约 7.3 秒构建，展开 11 个快捷链接，全部 fd 成功退出。**此数据只证明存储和构建，不代表搜索时延。**

## 局限与人工验收项

1. Node/Raycast 正常结束可尝试终止活动子进程；**SIGKILL、系统掉电、宿主进程硬崩溃不能保证没有短暂孤儿进程**。跨进程硬保证需采用操作系统级进程监督机制，不能在现有 TS 层声称已实现。
2. Build Index 页面退出/手动取消的体验仍需用户 macOS 实机验证；CI 通过真实进程验证搜索取消/强制结束，但不能模拟每个 Raycast 页面关闭行为。
3. **Open/Save 粘贴**需要在目标 macOS 应用实际对话框内验收；PathSeek 不模拟系统点击“打开/保存”。
4. 自定义快捷目录若指向家目录内的真实路径，同一文件可能以真实路径和快捷路径出现两次（设计行为）。
5. 不在未量化搜索延迟前引入 GPU。Brotli 解压原生工作在 CPU 上，GPU 离散转移开销/重写算法的复杂度未证明有净收益。

## 本地检查与真实 benchmark

```bash
git pull --ff-only
npm ci
npm test
npm run build
npm run lint:code
npm run format:check

INDEX="$HOME/Library/Application Support/com.raycast.macos/extensions/pathseek/index-development-v3/index.nul"
test -f "$INDEX" || { echo "No previously built v3 index found"; exit 1; }
npm run benchmark:index -- "$INDEX" "kernel"
npm run benchmark:search -- "$INDEX" "kernel" "drivers" "unlikely-to-exist-9876"
```

`benchmark:index` 测量完整解压与一次 fzf 查询，`benchmark:search` 更贴近扩展的搜索输出上限。两者都**只读取**现有索引，不调用 fd、不重建、不覆盖任何数据。先根据 `decodeMs` 和 `elapsedMs` 确定瓶颈，再考虑 CPU 多核；只有有可测收益才评估 GPU。

## 合并门槛

- macOS CI 的 `npm test`、`ray build`、TypeScript、ESLint、Prettier 检查全部通过。
- Merge 前保留 PR 和分支用于复现；不要删除或重命名用户现有的索引目录。
- 合并仅更新 GitHub `main` 源码；**不会在用户 Mac 自动安装、发布到 Raycast Store 或自动触发索引重建**。
