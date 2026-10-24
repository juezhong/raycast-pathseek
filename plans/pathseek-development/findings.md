# Findings — PathSeek

- Plan ID: pathseek-development
- Checkpoint ID: pathseek-20261024-01
- Last Updated: 2026-10-24

## 需求确认
- 开发独立的 macOS Raycast 文件搜索工具，目标为 Listary 风格的直接搜索、Finder 定位和应用 Open/Save 文件对话框内导航。
- 插件独立维护索引，不依赖不可控的 Raycast 内部索引；普通搜索不再全盘运行 fd。
- fd 仅用于首次及手动 Rebuild Index；默认无定时刷新和文件系统自动监听。
- 持久化索引由 fzf 模糊匹配，文件名及完整路径均可搜索；支持文件与目录过滤、搜索范围、隐藏文件及排除路径。
- 打开文件、Show in Finder、打开所在目录、复制路径均是首版功能。
- Dialog Bridge 必须恢复原应用文件选择窗口；不能仅打开新 Finder；第一版不自动执行 Open/Save 确认。

## 技术决策与权衡
| 选型 | 原因与边界 |
| --- | --- |
| Raycast + TypeScript/React | 对接现有 Raycast 开发环境与快捷入口 |
| 选择性复用 Fuzzy File Search | 预计可沿用搜索 UI、fd/fzf 调用和 Finder Actions；仍需审查当前源码与许可 |
| fd -> 临时索引 -> 校验 -> 原子替换 | 显式构建，失败保留旧索引 |
| fzf 查询既有索引 | 避免反复目录遍历；读取索引有 I/O 与 CPU 成本，须实测 |
| Raycast environment.supportPath | 本地持久化索引，不提交用户路径到 GitHub |
| 手动重建默认 | 用户明确要求可控，不自动刷新，新文件需手动更新 |
| AppleScript / Accessibility | 作为对话框导航的候选方案，必须实机验证焦点、权限、兼容性 |

## 风险与未验证事项
- Fuzzy File Search 具体目录、代码及 MIT 归属需按最新 upstream 源码核对；保留第三方版权通知。
- NSOpenPanel/NSSavePanel 与自定义文件窗口有差异；兼容范围以 macOS 实机测试为准。
- 文件名可包含空格、Unicode、换行；索引格式需要明确分隔与序列化方案。
- SSD 磨损主要关注索引写入；fd 扫描的目录元数据读取与运行时开销仍需基准测试，不宣称零 I/O。
- 大型文件集需限制 fzf 结果量、输入节流、错误及权限处理。
- Raycast Store 可能审核重复功能；必须突出索引自主管理与原对话框集成差异。

## 参考
- https://github.com/raycast/extensions/tree/main/extensions/fuzzy-file-search
- https://developers.raycast.com/
- https://github.com/sharkdp/fd
- https://github.com/junegunn/fzf

## 下一步
审查 raycast/extensions 仓库 extensions/fuzzy-file-search 当前源码与 MIT 许可，形成复用与重构清单；在获得额外代码写入授权前不修改源码。
