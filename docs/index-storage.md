# PathSeek 索引存储

PathSeek 在 Raycast 的 `environment.supportPath` 下维护索引。开发模式使用独立的 `index-development-v3/` 子目录，避免覆盖正式版索引。

## 手动索引

- 仅用户明确执行 **Build Index** 时调用 `fd`。搜索、打开状态和诊断界面不会重扫磁盘。
- `fd` 的路径流直接进入前缀编码器和 Brotli 压缩流，不会额外写入完整的 8GB 未压缩路径副本。
- 重建时仍会同时保留旧版索引和一个压缩的临时索引；构建成功后原子替换。
- 重建尚未成功发布时，**View Index Status** 可能显示 `not built`；请到 **Build Index** 查看实时进度或 **View Diagnostics** 查看持久化心跳。

## v3 压缩格式

```text
[8 bytes: "PSIDX003"][4 bytes JSON length][JSON metadata]
[optional reserved header space to byte 65536]
[Brotli encoded prefix-delta NUL path records]
```

索引使用 UTF-8 原始路径字节、与上一条路径共享的前缀长度（unsigned LEB128）以及剩余路径字节来编码；随后进行无损 Brotli 压缩。解压后直接输出原始 NUL 分隔路径到 `fzf`，不产生未压缩的磁盘临时文件。

Brotli 压缩等级可以在扩展偏好设置中选择：5（快）、7（平衡，默认）、9（高）、11（最高，可能极慢）。**最高等级不保证在所有文件路径数据上都获得最佳压缩率**。改变等级后需要手动重建。

```text
fd --absolute-path --print0
    → PathPrefixEncoder → Brotli(quality=5|7|9|11)
    → staged index → atomic rename(index.nul)

index.nul → BrotliDecompress → PathPrefixDecoder
    → fzf --read0 --filter
```

## 诊断和压缩测试

Build Index 页和 View Diagnostics 显示持续刷新的原始输入字节数、路径数量、压缩输出字节数、耗时、处理速率、根目录序号、压缩等级和扩展进程的 CPU 用时。记录不包含真实文件名、路径、搜索词、排除规则。进度文件固定为一个小型 `build-progress.json`，大约每两秒更新一次（不记录逐条路径），异常终止会保留最后一次心跳。心跳不断更新不代表 `fd` 正在产生数据。

对旧 v2 索引可以运行：

```bash
npm run benchmark:quality -- "/absolute/path/to/old/index.nul" 2
# 可选：比较非常耗时的 quality=11
npm run benchmark:quality -- "/absolute/path/to/old/index.nul" 2 --include-max
```

该工具最多读取指定 MiB 的原始路径数据，所有压缩结果都在内存中计算，终端只输出汇总数值，不创建额外的索引文件。样本结果不能代替完整 8GB 测试。

也可以将旧索引转换到不存在的新目录，使用第三个参数指定压缩等级（默认7）：

```bash
npm run convert:index -- "$OLD_INDEX" "$TEST_DIR" 7
```

## 兼容和安全

- v2 旧格式为 `PSIDX002` + JSON 头 + NUL 分隔完整绝对路径，仍可搜索。
- 旧 v1 索引通过 `index.json + index-<UUID>.nul` 读取，保持向后兼容。
- 构建失败或中止前不会替换当前有效索引。
- 跟随符号链接（`--follow`）与包含隐藏文件（`--hidden`）可能显著扩大扫描范围。排查时建议先取消 **Follow Symbolic Links**。
- 压缩文件仍含有真实的文件名和路径。不要把 `index.nul` 上传至公开 Issue，只发送 `Copy Sanitized Debug Info`。

详细实机步骤见 [compressed-index-testing.md](compressed-index-testing.md)。
