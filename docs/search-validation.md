# PathSeek v3 搜索性能与 Open/Save 验证

索引构建、压缩和选择性软链接扫描已通过本分支的 macOS CI。下一步验证搜索体验。整个流程**不会重新构建索引，也不会删除或覆盖文件**。

## 1. 启动当前测试分支

```bash
git switch feat/compact-compressed-index-v3
git pull --ff-only
npm ci
npm test
npm run build
npm run dev
```

在 Raycast 的开发版 **View Index Status** 中找到并复制 **Copy Active Index File Path**。本分支通常位于 `.../index-development-v3/index.nul`，不要使用正式版路径。

## 2. 无需索引缓存的独立基准测试（推荐）

如果经常卸载插件导致 `environment.supportPath` 下的索引文件消失，可直接在本仓库运行：

```bash
npm run benchmark:standalone -- "$HOME" --shortcuts "$HOME/Symlinks" --hidden
```

不依赖 Raycast 插件安装或先前的 `index.nul`。脚本通过 `fd` 扫描给定根目录，可选地展开一个快捷目录中的直接目录软链接（目标内部不再次跟随），使用 Brotli 7 生成临时 v3 索引，校验逐条路径数量与原始字节数，接着自动完成三种 `fzf` 查询，最后**删除脚本自己创建的临时索引**。它不会修改你的文件或任何 Raycast 索引。

默认跳过隐藏文件；若你想与自己的 PathSeek 配置一致，可追加 `--hidden`。默认排除 `.git` 和 `node_modules`，压缩等级可以用 `--quality 5|7|9|11` 改变。 `--shortcuts` 是可选的，且必须指向一个存在的真实目录。

脚本自动生成三种查询，不需要事先确定是否存在某个文件：

- 简短查询 `a`（测常见命中场景）。
- 从实际索引路径的文件名抽取一个简单词（测较具体的查询）。
- 随机生成几乎不可能命中的测试词（负对照，**不需要对应文件存在**）。

报告只包含数值和场景标签，不输出文件名、绝对路径或查询文本。因为每次都会扫描和构建，因此 `buildMs`、`decodeMs`、查询耗时需要分别比较。此命令由用户主动运行，没有后台或定时任务。

如果只想比较搜索，不必重复构建，可以在开发插件已存在 v3 索引时使用下一小节的 `benchmark:search`。

## 3. 数值化测量已有索引的搜索延迟

在新终端中进入仓库目录，复制索引路径；以下路径仅用于说明，必须替换为你实际复制到的路径：

```bash
INDEX="/path/copied/from/development/index.nul"
npm run benchmark:search -- "$INDEX" "kernel" "drivers" "something-unlikely-to-exist-9876"
```

- 依次完整读取同一份压缩索引、流式解压并执行 **真实的** `fzf --extended --read0 --print0 --filter`。
- 与插件搜索使用相同的 150 条结果上限；达到上限会结束当前 `fzf` 子进程。
- `elapsedMs` 包括创建进程、读取/解压、模糊过滤和关闭子进程的时间。
- `resultCount`、`limitReached`、`exitCode` 用于验证输出上限和空结果。
- 输出只包括搜索词的 UTF-8 字节数（`queryLength`），不会输出搜索词、文件名或绝对路径。
- 有关 indexBytes 等数据仍可以通过 `npm run benchmark:index -- "$INDEX" "kernel"` 查看；该工具会完整解码索引并再次执行 fzf。

建议至少选择一个常见词（命中多）、一个较具体词（命中少）、一个不存在的词。相同词也可以重复三次，观察系统缓存对延迟的影响。

## 4. macOS GUI 功能验证

在 PathSeek 开发版的 **Search Indexed Files** 与 **Find in Open/Save** 中：

1. 搜索常见词、中文、路径片段、带空格的文件名；检查结果与实际文件一致。
2. 快速连续修改输入，例如 `ker` → `kernel` → `kern`，检查较早搜索不会覆盖新结果，界面没有长时间停留在加载状态。
3. 搜索自定义快捷目录中的文件，确认结果路径保留 `~/Symlinks/<alias>/...` 形式（实际复制时是绝对路径），同时操作系统能够访问该路径。
4. 打开另一个应用的 macOS Open/Save 对话框，调用 **Find in Open/Save** 并使用 **Paste Full Path**。若目标应用要求通过“前往文件夹”，先使用 `⌘⇧G`。
5. 打开 **View Diagnostics**；若已开启开发者执行追踪，可看到 `fzf` 的耗时、结果数和取消状态，不会记录搜索词。

插件不会自动按下打开或保存按钮。

## 5. 结果如何判断

- 搜索返回了正确文件，但耗时数秒：可以继续根据用户接受的延迟评估是否需要 CPU 并行/内存缓存；压缩文件仍应保持小体积。
- 连续输入时结果错乱、进程残留或 UI 卡死：优先修复取消/资源管理。
- 搜索能找到真实目标，却找不到快捷目录别名：检查 Build Index 是否选择了正确的单一 `Symlink Shortcut Folder`，以及最后一次构建是否在配置修改之后。
- 没有匹配项且 `exitCode=1`：这是 `fzf --filter` 的正常无匹配状态，不代表索引损坏。

反馈时请只发送 `benchmark:search` 的 JSON 数值、是否成功粘贴路径、以及需要排查的错误码。**不要上传 `index.nul`**。
