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

## 3. Raycast 开发版功能验证

```bash
npm run dev
```

在 Raycast 中找到本地开发版 PathSeek：

1. **View Index Status**：确认初始状态没有开发版索引，或显示的是 `index-development-v3` 目录，而不是正式版本的文件路径。
2. **Build Index**：先选一个小目录（如自己的代码项目），手动建立 v3 索引。
3. **View Index Status**：确认 Format 为 `v3 prefix + Brotli (compressed)`，记录 `Index size` 和 `Bytes per path`。
4. **Search Indexed Files**：搜索中文、英文、包含空格的文件；核对结果和实际文件路径。
5. **Find in Open/Save**：在 macOS Open/Save 对话框中选择搜索结果并验证路径粘贴。

小目录验证通过后，如愿意，可在开发版中将索引目录改为家目录并重新构建。**这会替换开发版的索引，但不影响正式版原始索引。**

## 4. 回传结果与恢复

回传 `benchmark:index` 的两份 JSON 数值、`convert:index` 的 JSON 数值，以及 `View Diagnostics → Copy Sanitized Debug Info`。也可描述实际搜索是否出现卡顿、空结果或长时间运行。

按 `Ctrl+C` 停止 `npm run dev`；正式版索引不受影响。测试目录可自行检查后再删除，但删除属于不可恢复操作；如仍需反复测试，建议先保留。

## 5. 尚未完成的验证

本分支虽有 macOS GitHub Actions 测试，但尚无你的完整家目录的实际基准数据。暂不能保证：

- 压缩率达到固定目标
- 全盘重建时间
- 查询响应始终在数秒内
- GPU 能改善此类顺序压缩任务

评估结果将用于决定是否引入排序/目录字典、CPU 多核分块或者 GPU 加速。
