# PathSeek 性能基准（唯一完整验收入口）

## 固定命令

```bash
npm run benchmark:standalone -- "$HOME" \
  --shortcuts "$HOME/Symlinks" \
  --hidden \
  --quality 7 \
  --runs 5 \
  --compare
```

> 仅当 `$HOME/Symlinks` 是确实存在的**真实目录**（不能本身是软链接）时使用上述参数。未配置该目录时，省略整个 `--shortcuts` 参数，不要创建虚构的快捷目录。

## 与正式索引构建一致的软链接规则

- 普通 `fd` 扫描**不加 `--follow`**，因此不会进入目录中的软链接目标。
- `--shortcuts` 调用正式程序相同的 `discoverSelectiveSymlinks`，只处理该真实目录**直接子项**中的有效**目录软链接**；失效、不可访问或指向文件的链接跳过。
- 扫描被选中的目标时仍不加 `--follow`，并使用正式 `AliasPathMapper` 把索引中输出的真实路径映射回原软链接路径。
- 如果某个快捷目录的目标本就位于 `$HOME` 下，可能得到真实路径和软链接别名两组记录。这是**不同的可见路径**，不能理解为无限递归，但可能增加扫描耗时和索引条数。
- 基准测试在 `os.tmpdir()/pathseek-benchmark-XXXXXX` 中创建 `stage.nul.tmp`，成功构建后通过原子发布生成 `index.nul`。不使用旧缓存，不修改 Raycast 索引。完成后删除**本次基准的**临时索引及目录，不操作用户目录或插件数据。
- 启动、创建暂存文件、发布索引、清理以及验证删除状态都会显示 `[PathSeek benchmark]` 操作日志；如发生错误也会尝试清理并报告结果。正常清理成功时明确输出 `Removed temporary directory (verified)`，失败则输出 `CLEANUP FAILED`。
- 操作日志写入 **stderr**，统计 JSON 写入 **stdout**。使用 `> benchmark-result.json` 保存 JSON 时，仍会在终端显示临时目录操作记录。若被 `SIGKILL` 或突然断电终止，无法保证执行最终清理。

## 结果字段与判定

| 字段 | 含义 |
| --- | --- |
| `scanRoots` / `symlinkTargets` / `symlinkLinksSkipped` | 扫描根数量、找到的快捷目录软链接目标、跳过的无效链接 |
| `indexedPaths` / `compressedBytes` / `compressionSavingsPercent` | 索引规模、压缩大小、压缩率 |
| `buildMs` / `buildCpu` | 本次冷启动索引构建耗时与 Node CPU |
| `decodeStats.p50Ms/p95Ms` | 压缩索引读取/解码延迟 |
| `queries[].kind/p50Ms/p95Ms/resultCount/limitReached` | 搜索类型、各 5 轮分位延迟、结果数及上限 |
| `compareRequested` / `comparison` | 同一新建索引中名称搜索、连续父目录路径搜索和固定 `dyc/dec` 拼音路径负载；**不是两次 Git 版本之间的对比** |
| `nodeRss.sampledPeakBytes` | 仅 Node 进程的 50ms 采样峰值 |
| `processTreeRss.peakCombinedRssBytes` | Node + 其子进程同一采样时点的合计 RSS 峰值 |
| `processTreeRss.peakFdRssBytes / peakFzfRssBytes` | 观测到的 fd/fzf 单类进程合计峰值 |
| `processTreeRss.sampled / failures` | 采样次数与采样错误次数；若采样失败不能据此推断内存安全 |

**注意：** RSS 进程树采样间隔 250ms，并不能保证捕捉短暂峰值；同时取到的 fd/fzf 峰值属于各自时间点，不能直接相加作为总内存峰值。对于上次的约 8GiB 问题，应优先检查 `processTreeRss.peakCombinedRssBytes`，必要时结合 macOS 活动监视器。

## 保存与回传

将 JSON 输出保存用于不同提交间的对比（不要公开私人绝对路径；输出默认只有摘要数字）：

```bash
npm run benchmark:standalone -- "$HOME" \
  --shortcuts "$HOME/Symlinks" \
  --hidden --quality 7 --runs 5 --compare > benchmark-result.json
```

记录对应 Git commit、macOS 版本、可用内存及是否连接外部存储。对于不同提交，应使用完全相同的命令、扫描范围和机器配置。

## 性能回归记录（本次开发分支）

在约 87 万条路径的真实 macOS 索引上，首轮 5 次测量显示普通名称和无结果查询 P50 约 1.4 秒，而目录模式约 0.5 秒。为降低普通查询每条记录的 CPU 与内存分配成本，针对**不含中文及其他非 ASCII 字符、也不含 TAB 的名称**启用 Buffer 字节级快速路径；所有中文名称、混合语言名称、其他 Unicode、带 TAB 的名称仍走原有拼音转换及名称转义逻辑。该优化仅根据候选文件名实际字节决定是否需要文字解码，不根据查询语言决定是否启用拼音，不改变模糊匹配语义。实际改进幅度以同一机器、相同索引规模下重新执行固定命令为准。
