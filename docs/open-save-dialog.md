# Open/Save 文件选择：快速定位文件或进入目录

**产品目标只保留两件事：** 在原来的 macOS Open 对话框里搜索并快速选中一个文件；或在 Open/Save 对话框里搜索并进入一个文件夹。不做 Listary 式活动窗口监控、自动弹出文件管理器、Accessibility helper 或后台服务。

此功能已通过维护者 Mac 核心路径粘贴实测，并随 [PR #8](https://github.com/juezhong/raycast-pathseek/pull/8) 合并到 main。文件最终高亮、父目录备用动作等细节参见 Issue #7。

## 操作步骤（尽量少的按键）

1. 先在需要选文件的**原应用 Open 对话框**里按 **⌘⇧G**，打开「前往文件夹」输入框。
2. 呼出 Raycast → **Search in Open/Save Dialog**，搜索想要的文件或文件夹。
3. 选中 PathSeek 结果后按 **Return**：将所选结果的**完整绝对路径**粘贴回原应用的输入框。
4. 回到原应用手动按 **Return**。若输入的是文件夹，应进入该目录；若是文件，标准 macOS Open 对话框可能定位并选中该文件。此文件选择行为需在用户 macOS 15.1.1 上确认；不同应用可能不同。
5. 手动检查结果，需要时才自行点击 **Open**、**Save**；PathSeek 不代替用户提交操作。

如果完整文件路径在某个应用不适用，可按 **⌘K → Go to Containing Folder (Fallback)**，先进入该文件所在目录，再手动选文件。保存文件时通常也是进入目标文件夹，不自动填写或覆盖保存文件名。

## 更快捷的唤起方式：只需设置一次 Hotkey

使用 Raycast 官方的全局命令快捷键，无需再打开 Raycast 根搜索、输入插件名字：

1. 打开 Raycast **Settings → Shortcuts**，找到 PathSeek 的 **Search in Open/Save Dialog**，选择 **Record Hotkey**。建议试用 `⌃⌥G`（若与本机软件冲突，换一个未占用的组合）。
2. 在原应用的 Open/Save 文件对话框按 **⌘⇧G** 打开 Go to Folder。
3. 紧接着按刚设的 PathSeek Hotkey，直接进入搜索；找到结果后按 **Return** 粘贴。
4. 在原对话框自行确认目录导航或文件选择，不自动点击 Open/Save。

**不要直接把 Raycast 命令绑定到系统的 ⌘⇧G**：同一个组合被 Raycast 拦截时，macOS 原有的 Go to Folder 不一定还能触发。公开的 Raycast 扩展 API 也没有让扩展窗口精确贴近其他应用小窗口的简单定位接口，不为此增加窗口控制依赖。

体验优化跟踪：[Issue #10](https://github.com/juezhong/raycast-pathseek/issues/10)；现有基本流程已可用，未来若有实际摩擦再做最小改进。

## 技术实现保持简单

- 新增一个 `Search in Open/Save Dialog` 命令，复用原 Search Files 的已有持久索引和 fzf 模糊搜索。
- Raycast `Action.Paste` 只粘贴文本，**默认完整路径**、备用父目录；无独立正则、无 `fd` 自动构建。
- 不识别活动文件面板、不调用 AppleScript、Swift helper、Accessibility API、不发送模拟按键，不增加常驻进程。
- 原有 Search Files 的 Finder/Open Actions 不变。
- **必须在 ⌘⇧G 的输入框已经聚焦时启动 Raycast**。否则可能将文本粘贴到错误的输入区域；这一阶段不做自动焦点控制。
- 只面向标准 macOS Open/Save 对话框及支持 Go to Folder 的应用；其他自定义面板不保证适用。也不承诺文件路径一定能在每种应用中被选中。
- 只有用户手动 Rebuild Index 才扫描目录；旧索引中已删除的文件可能不能定位。

## 验收和范围

- [Issue #7：只需简单 Mac 操作](https://github.com/juezhong/raycast-pathseek/issues/7)：一个文件的定位/选中、一个目录的进入、回到原应用以及不自动打开/保存。
- [PR #8](https://github.com/juezhong/raycast-pathseek/pull/8)：代码及 CI；Draft 状态等待 Mac 实测，不会自动合并。
- 原先的 P4.2「主动识别并自动操作当前文件面板」已按维护者要求**取消/不在产品范围内**，不会作为后续必需里程碑。

## 参考

- [Apple：macOS 前往文件夹](https://support.apple.com/en-euro/guide/mac-help/mchlp1236/mac)
- [Raycast：Action.Paste](https://developers.raycast.com/api-reference/user-interface/actions)
- [macOS 社区：Open 对话框可使用完整文件路径的经验](https://superuser.com/questions/1538458/is-it-possible-to-paste-the-file-path-into-open-file-dialog-in-macos/1538558)（非所有应用的官方保证）
