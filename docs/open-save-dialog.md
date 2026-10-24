# P4：在原应用 Open/Save 文件对话框中导航

> 当前分支 `feat/p4-assisted-open-save-navigation`：**P4.1 辅助导航候选实现**，尚未合并 main，macOS GUI 尚未由维护者实测。终极目标 P4.2（一键判断并导航当前标准面板）尚未实现。

## P4.1 — 不依赖 Accessibility 的安全工作流

PathSeek 使用 Raycast 官方 `Action.Paste` 将目录路径发送给此前正在输入的应用。**不会触发新的 Finder 窗口，不会模拟快捷键，也不会触发 Open/Save 按钮。**

在 TextEdit、Preview 或其他有标准 macOS 文件对话框的应用尝试：

1. 在**原应用**打开一个 **Open** 或 **Save As** 对话框。
2. 在那个对话框按 **⌘⇧G**（Go to Folder / 前往文件夹），保持输入框处于焦点。
3. 呼出 Raycast，执行新命令 **Search in Open/Save Dialog**。可以在 Raycast 设置里为它分配一个自己喜欢的热键。
4. 输入搜索词并选定索引结果，按 **Return** 触发第一项 **Paste Containing Folder into Go to Folder**。
5. Raycast 关闭并尝试把选中结果的**父文件夹路径**粘贴到原应用的 Go to Folder 输入框。由你手动按 **Return** 在原文件对话框里导航，然后选择要打开/保存的项目。
6. 如果搜索到的结果本身是**文件夹**，可以用 **⌘K → Paste Selected Path (For Folder Results)**，将该文件夹的完整路径粘贴到原对话框，而不是父目录。

### 为什么默认粘贴父文件夹？

持久化索引存储的是绝对路径，并没有把“文件或目录”类型作为必备字段。在所有查询结果上先同步 stat 会增加文件系统 I/O，违背普通搜索的性能目标。对已选**文件**，粘贴父文件夹可以定位到该文件所在位置；对已选**目录**，第二个动作可粘贴其本身。之后可考虑索引文件类型或按需状态检查。

### P4.1 明确的限制

- 必须**先由用户按 ⌘⇧G**，确保目标 Go to Folder 文本框已经存在且被聚焦；插件此阶段不会自动打开该框。
- 粘贴目标是用户此前的前台输入位置；如果焦点不在 Go to Folder，文字可能被粘贴到其他输入框。操作前应确认焦点。
- 粘贴路径**不代表导航已成功**；仍需用户手动在原对话框确认「前往文件夹」。
- 不检测 NSOpenPanel / NSSavePanel 是否存在，也不能保证所有第三方应用的自定义对话框支持该快捷键。
- PathSeek 不读取剪贴板历史、不用 AppleScript、不申请 Accessibility、无后台进程，不在搜索过程中执行 fd。
- 如果索引中的路径已被移除，Go to Folder 可能无法找到对应文件夹；手动 Rebuild Index 可更新索引。

## P4.2 — 正式的一键原位导航（下一阶段）

完整 Listary 风格需要从 Raycast 中确定**用户原来的应用及活动文件面板**，而不是猜测当前焦点。后续将单独调查/验证：

1. 应用切换时的原应用识别：Raycast 显示后，“当前最前应用”通常不再是打开面板的应用；不能随意把键盘事件送给 Finder 或最近使用的任意应用。
2. macOS Accessibility 权限、AXUIElement 的目标窗口/控件状态和失效处理。权限应由用户自愿授予，失败时不产生键盘输入。
3. 标准 NSOpenPanel/NSSavePanel 与自定义面板分别定义支持等级；不得把所有应用一概标记兼容。
4. 仅在可信的已识别文件面板执行「前往文件夹」，绝不自动点击 **Open / Save / Replace**，也不覆盖用户选择。
5. 制定可复现的 Mac 测试矩阵：至少一个 Open、一个 Save As；输入法、中文路径、多个窗口、权限拒绝、无文件面板、取消操作都需要验证。

P4.2 不应该在未验证目标面板识别前简单用 AppleScript `System Events keystroke` 向任意活动窗口注入字符。

## 官方依据

- [Apple：macOS 快捷键，包括 ⌘⇧G 前往文件夹](https://support.apple.com/zh-cn/102650)
- [Raycast：Action.Paste（关闭 Raycast 窗口并粘贴至之前的应用）](https://developers.raycast.com/api-reference/user-interface/actions)
- [Apple：AXIsProcessTrustedWithOptions（后续 Accessibility 权限评估）](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)
- [Apple：NSSavePanel（标准保存面板）](https://developer.apple.com/documentation/AppKit/NSSavePanel)

相关源码：`src/dialog-search.tsx`、`src/search-files.tsx`、`src/lib/dialog-navigation.ts`。
