# Open/Save 文件选择：快速定位文件或进入目录

**产品目标只保留两件事：** 在原来的 macOS Open 对话框里搜索并快速选中一个文件；或在 Open/Save 对话框里搜索并进入一个文件夹。不做 Listary 式活动窗口监控、自动弹出文件管理器、Accessibility helper 或后台服务。

此功能已通过维护者 Mac 核心路径粘贴实测，并随 [PR #8](https://github.com/juezhong/raycast-pathseek/pull/8) 合并到 main。文件最终高亮、父目录备用动作等细节参见 Issue #7。

## 推荐用法：直接 ⌘⇧F（2026-10-24 Mac 实测通过）

维护者在当前 macOS 与所测试的 Open/Save 文件选择窗口里确认，**无需先按 ⌘⇧G**：直接按已绑定的 `⌘⇧F` 启动 PathSeek 的 **Search in Open/Save Dialog**，搜索文件/文件夹、按 **Return** 粘贴完整绝对路径，原窗口就能选中正确文件或跳到正确目录。这比原先的两组快捷键更简洁。

1. 在原应用打开 Open 或 Save 文件选择窗口。
2. 按 `⌘⇧F`，直接进入 PathSeek 搜索并选择结果。
3. 按 **Return**，Raycast 原生 `Action.Paste` 会把结果完整路径送回原文件选择窗口；在已测试的环境里，这足以选中文件或进入文件夹。
4. 用户自己确认最终的 Open / Save，PathSeek 不自动点击。

**兼容后备**：某些应用的自定义文件面板或焦点状态可能无法直接接收绝对路径。遇到这种情况，先在原对话框按 `⌘⇧G` 打开「前往文件夹」，再按 `⌘⇧F` 搜索、Return 粘贴，必要时手动按 Return 完成导航。若完整文件路径无法直选，可用 PathSeek 的 **⌘K → Go to Containing Folder (Fallback)** 进入文件所在目录再选择文件。

## 全局快捷键的一次性设置

Raycast 扩展 Manifest 不支持在安装时静默注册全局 Hotkey。第一次只需在 Raycast 根搜索中选中 **Search in Open/Save Dialog** → **⌘K → Configure Command → Set Hotkey**，录入 `⌘⇧F`；或在 Raycast Settings → Shortcuts 找到该命令配置。维护者已在本机设定并使用成功。

`⌘⇧F` 可能与某些应用自身的“在文件中搜索”冲突；如发生冲突，请在 Raycast 改用未占用的组合。不要把 PathSeek 绑定到系统原有的 `⌘⇧G`，避免抢占系统「前往文件夹」动作。

## 稳定开发基线

- [v0.1.0 Git Tag](https://github.com/juezhong/raycast-pathseek/tree/v0.1.0)：带说明的、经维护者 Mac 实测的稳定开发版快照（固定提交 `9cf81375c059762f22c2d7973b25f302337a6155`）。
- 这是开发里程碑，不是 Raycast Store 已审核发布版本。后续文档与仓库主分支可能继续更新，但 Tag 不会移动。
- [Issue #7](https://github.com/juezhong/raycast-pathseek/issues/7) 记录真实文件选中/目录进入结果；[Issue #10](https://github.com/juezhong/raycast-pathseek/issues/10) 记录 Hotkey 使用体验。

## 技术实现保持简单

- 新增一个 `Search in Open/Save Dialog` 命令，复用原 Search Files 的已有持久索引和 fzf 模糊搜索。
- Raycast `Action.Paste` 只粘贴文本，**默认完整路径**、备用父目录；无独立正则、无 `fd` 自动构建。
- 不识别活动文件面板、不调用 AppleScript、Swift helper、Accessibility API、不发送模拟按键，不增加常驻进程。
- 原有 Search Files 的 Finder/Open Actions 不变。
- 维护者测试的文件选择窗口直接接收路径粘贴，**无需预先 ⌘⇧G**；其他应用不保证相同焦点行为，可能需要先用 ⌘⇧G 激活 Go to Folder。PathSeek 不做自动焦点控制。
- 只面向标准 macOS Open/Save 对话框及支持 Go to Folder 的应用；其他自定义面板不保证适用。也不承诺文件路径一定能在每种应用中被选中。
- 只有用户手动 Rebuild Index 才扫描目录；旧索引中已删除的文件可能不能定位。

## 验收和范围

- [Issue #7：只需简单 Mac 操作](https://github.com/juezhong/raycast-pathseek/issues/7)：一个文件的定位/选中、一个目录的进入、回到原应用以及不自动打开/保存。
- [PR #8](https://github.com/juezhong/raycast-pathseek/pull/8)：已合并 main，并由维护者在 Mac 验证核心 Open/Save 路径粘贴与文件选中/目录进入。
- 原先的 P4.2「主动识别并自动操作当前文件面板」已按维护者要求**取消/不在产品范围内**，不会作为后续必需里程碑。

## 参考

- [Apple：macOS 前往文件夹](https://support.apple.com/en-euro/guide/mac-help/mchlp1236/mac)
- [Raycast：Action.Paste](https://developers.raycast.com/api-reference/user-interface/actions)
- [macOS 社区：Open 对话框可使用完整文件路径的经验](https://superuser.com/questions/1538458/is-it-possible-to-paste-the-file-path-into-open-file-dialog-in-macos/1538558)（非所有应用的官方保证）
