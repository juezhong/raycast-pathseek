# PathSeek v3 压缩索引：macOS 实机验证

此文档用于 `feat/compact-compressed-index-v3` 测试分支。它是尚未发布的开发版本。

## 0. 安全约束

- **不要直接在正式版本执行 Rebuild Index 来测试本分支。**
- 本分支的 Raycast 开发模式将索引保存在 `environment.supportPath/index-development-v3/`，不覆盖正式版本 `environment.supportPath/index.nul`。
- 离线转换命令只读取旧 `index.nul`，目标必须是**全新的、不存在的目录**。如果目标存在，命令会失败，而不是覆盖。
- 8 GB 的旧索引在整个测试过程中仍保留。产生的新测试数据只有压缩后的索引及少量元数据，但它仍然需要额外磁盘空间。
- 不要上传 `index.nul` 或含真实路径的终端日志；只分享工具输出的数值及 `View Diagnostics → Copy Sanitized Debug Info`。
- 这版只使用 CPU；尚未实现 GPU 加速。压缩质量固定 Brotli 11，构建可能耗时很长。优先比较压缩率和正确性。

## 1. 准备源码

```bash
git clone --branch feat/compact-compressed-index-v3 --single-branch https://github.com/juezhong/raycast-pathseek.git
cd raycast-pathseek
node --version
npm ci
brew install fd fzf
npm test
npm run build
```

Node.js 至少需要 22.14。确认测试、构建都成功再进入下一步。如果你已安装 fd/fzf，不用重复安装。

## 2. 不重扫磁盘：直接评估旧 8GB 索引可以压缩多少

首先在现有 PathSeek 正式版本中打开 `View Index Status`，使用 `Copy Active Index File Path` 复制旧索引绝对路径。**以下路径变量需要替换为你实际复制的路径**：

```bash
OLD_INDEX="/path/copied/from/view-index-status/index.nul"
TEST_DIR="$HOME/pathseek-v3-evaluation"
```

`TEST_DIR` 必须不存在；若已存在请更换一个新目录名。先测量旧索引：

```bash
npm run benchmark:index -- "$OLD_INDEX" "kernel"
```

然后将原有索引转成测试用 v3 格式（不会修改或删除旧文件）：

```bash
npm run convert:index -- "$OLD_INDEX" "$TEST_DIR"
```

转换完成后验证完整索引能正确解码、路径数量一致，以及解压搜索延迟：

```bash
npm run benchmark:index -- "$TEST_DIR/index.nul" "kernel"
```

可把 `kernel` 换为你实际使用的非敏感搜索词。以上命令均不会输出搜索结果路径；仅输出数值统计。

主要记录：

- `indexedPaths` / `verifiedPaths` 是否一致
- `compressedBytes` 与 `rawBytes`、`sizeReductionPercent`
- `decodeMs`、`fzfSearchMs`
- 转换命令报告的 `originalBytes`、`compressedBytes`

注意：离线转换不会重新扫描文件系统，搜索覆盖范围以原索引为准。离线压缩后的测试索引不自动被 Raycast 使用。

## 3. 在 Raycast 开发版直接搜索 8GB 原索引的压缩结果

```bash
npm run dev
```

在 Raycast 中打开开发版 **View Index Status**，使用 **Copy Active Index File Path** 复制开发版目标路径，然后回到终端：

```bash
DEV_INDEX="/path/copied/from/development/view-index-status/index.nul"

# 必须确认路径位于本分支隔离的开发版目录，禁止指向正式版。
case "$DEV_INDEX" in
  */index-development-v3/index.nul) ;;
  *) echo "Refusing to link outside development index directory"; exit 1 ;;
esac

mkdir -p "$(dirname "$DEV_INDEX")"

# 硬链接不复制压缩数据本体，且默认拒绝覆盖已存在的目标。
ln "$TEST_DIR/index.nul" "$DEV_INDEX"
```

`ln` 只能用于同一文件系统；如果报 `Cross-device link`，说明需要先确认是否愿意使用额外空间执行 `cp`。如果目标已有开发版索引，`ln` 会失败，**不要添加 `-f` 强制覆盖**。

重新打开开发版 **View Index Status**，确认索引格式为 `v3 prefix + Brotli (compressed)` 且文件数与原版一致。接着用 **Search Indexed Files** 搜索真实文件，测量等待时间，并用 **Find in Open/Save** 检查路径粘贴。

这样可以**不重新扫描整个家目录**，直接测试对 8GB 旧索引无损压缩后的真实搜索性能，且硬链接不会产生第二份压缩数据。

## 4. 可选：测试新的重建流程

如果你还想验证 `fd → 前缀编码 → Brotli` 的完整重建过程，可以在开发版 **Build Index** 中先选择一个小目录手动建索引，确认正常后再索引家目录。

执行 Build Index 会原子替换**开发版**索引，正式版的 8GB 数据不受影响。由于前面使用硬链接，位于 `TEST_DIR` 的压缩测试结果仍保留。

确认 **View Index Status** 的 Format、Index size、Bytes per path，之后测试中文、空格及换行文件名和 Open/Save 粘贴。


## 5. 回传结果与恢复

回传 `benchmark:index` 的两份 JSON 数值、`convert:index` 的 JSON 数值，以及 `View Diagnostics → Copy Sanitized Debug Info`。也可描述实际搜索是否出现卡顿、空结果或长时间运行。

按 `Ctrl+C` 停止 `npm run dev`；正式版索引不受影响。测试目录可自行检查后再删除，但删除属于不可恢复操作；如仍需反复测试，建议先保留。

## 6. 尚未完成的验证

本分支虽有 macOS GitHub Actions 测试，但尚无你的完整家目录的实际基准数据。暂不能保证：

- 压缩率达到固定目标
- 全盘重建时间
- 查询响应始终在数秒内
- GPU 能改善此类顺序压缩任务

评估结果将用于决定是否引入排序/目录字典、CPU 多核分块或者 GPU 加速。
