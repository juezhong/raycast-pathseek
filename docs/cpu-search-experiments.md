# CPU 搜索策略 A/B 实验（独立分支，不修改 Raycast 正式索引）

目标：从实测中判断当前 700ms 搜索耗时主要来自 Brotli 解压 / Node 数据流，还是 `fzf` 匹配与排序；同时量化取消排序的检索质量代价。**仅实验，正式的 Search Files 仍使用原有排序行为。**

## 克隆专用测试分支

在你希望放测试工程的目录执行（会新建 `pathseek-cpu-benchmark/`，不覆盖当前 `raycast-pathseek/`）：

```bash
git clone --single-branch --branch perf/cpu-search-strategies-v1 \
  git@github.com:juezhong/raycast-pathseek.git pathseek-cpu-benchmark
cd pathseek-cpu-benchmark
npm ci
npm test
```

如果未配置 SSH 权限，可以将仓库 URL 换成 `https://github.com/juezhong/raycast-pathseek.git`。

## 一条命令执行真实负载测试

```bash
npm run benchmark:standalone -- "$HOME" \
  --shortcuts "$HOME/Symlinks" \
  --hidden --quality 7 --runs 5 --compare
```

必须有 `fd` 和 `fzf` 在 `PATH` 中；无需安装 Raycast 插件，也无需任何旧索引。参数与此前实机测试一致。

脚本首先扫描一次 `$HOME`，并仅展开 `$HOME/Symlinks` 直接包含的目录软链接，默认排除 `.git` 和 `node_modules`。创建且只创建一个临时 v3 索引作为全部策略的共同数据源。随后测量完整解压、查询延迟和结果重合程度。

## 四种策略

| 标识 | 输入 | 搜索 | 特点 |
| --- | --- | --- | --- |
| `sorted-compressed` | v3 Brotli 流式解压 | fzf 默认排序 | 当前生产架构的基线 |
| `unsorted-compressed` | 同一个 v3 索引 | fzf `--no-sort` | 有可能提前获取 150 条结果，但失去相关性排序 |
| `sorted-memory` | 将该 v3 索引一次性解压到内存 | fzf 默认排序 | 隔离重复解压开销，代价是约 100 MiB 以上 RAM |
| `unsorted-memory` | 同一份内存解压数据 | fzf `--no-sort` | 观察内存缓存叠加提前返回的上限收益 |

每种策略都在以下三种由脚本自动生成的查询中运行：

- `frequent-early-limit`：短词，有机会很快达到 150 条上限
- `sampled-existing-filename`：从实际路径自动提取的一段文件名，无需手动指定
- `full-scan-no-match`：随机未命中控制组，需要处理全部输入

**每个 (策略, 查询) 组合会预热 1 次，再测 5 次**。全部比较共享同一份索引，不会为不同策略重新扫描或构建。

输出包括每种策略的 `p50Ms`、`p95Ms`、`firstResultP50Ms`、命中数以及 `resultOverlapWithSortedPercent`（与当前排序结果前 150 条的集合重合率）。排序质量并不能仅用重合率完整衡量，但它能直观揭示无排序策略是否丢失大量高相关候选。

## 临时文件和资源清理

脚本通过系统 `os.tmpdir()` 新建专属目录，格式为：

```text
<os.tmpdir()>/pathseek-benchmark-XXXXXX/
  stage.nul.tmp  # 写入中：固定头部预留 + Brotli 压缩数据
```

发布后使用原子 `rename`：

```text
<os.tmpdir()>/pathseek-benchmark-XXXXXX/
  index.nul  # 用于完整解压和四种 fzf 策略测试
```

**没有明文路径缓存文件**。`sorted-memory` / `unsorted-memory` 会额外暂存全部解码路径于 Node 的 RAM 中，不写盘，退出时自动释放。真实文件树均只读。脚本会向终端标准错误输出本次临时目录的**真实路径**和最终是否清理完成；JSON 结果不包含路径、文件名或查询词。

正常结束、普通错误或可捕获的 Ctrl+C 会尝试在 `finally` 中删除**仅本次**的临时目录；`SIGKILL` 或机器意外掉电无法保证清理。如果进程被强制中断，先以日志中打印的具体目录路径核实并手动处理，**不要盲目通配删除系统临时目录**。

`fd` 和 `fzf` 使用独立子进程。测试用父进程管理其生命周期并等待退出，执行中取消会请求终止；极端强制终止仍无法绝对杜绝孤儿进程。

## 如何判断 CPU 还是 GPU

1. `sorted-memory` 比 `sorted-compressed` 快很多：重复解压或数据流是重点，可研究 CPU 缓存/驻留索引，评估内存代价
2. `unsorted-compressed` 明显更快，但 `resultOverlapWithSortedPercent` 很低：有吞吐收益但排序质量代价较大，不应直接改生产默认
3. 四种策略都接近 700ms：说明仅解压/排序开关不足以优化，需要继续细分 fzf 匹配、IPC、进程启动成本
4. GPU 只有在确定主要计算瓶颈、且 CPU 优化无法满足响应目标时才考虑；Brotli 和 fzf 不能直接切换 GPU，必须付出额外的数据结构和实现成本

环境信息和结果是实验观测，不代表所选择的优化一定有端到端收益。若发送报告，只需标准输出的 JSON；日志中的临时目录绝对路径可以省略。
