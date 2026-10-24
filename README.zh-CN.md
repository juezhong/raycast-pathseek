# PathSeek

[English](README.md) | [**简体中文**](README.zh-CN.md)

**PathSeek** 是一款基于 Raycast 的开源 macOS 文件搜索与路径导航插件，目标是提供接近 Windows Listary 的“输入文件名快速搜索、定位所在目录，以及在应用文件选择窗口中跳转”的体验。

> **当前为开发测试版。** 持久化索引、模糊搜索和 Finder 文件操作已提交初始实现，但**开发期 CI 构建已通过，用户完成了部分 Mac 实测，但仍需完整回归验证**。直接导航其他应用已弹出的 Open/Save 文件对话框（Dialog Bridge）**尚未开发**，请勿将其误认为已支持。

## 主要功能

- **持久化索引**：第一次运行 `Rebuild Index` 手动建索引。此后索引满 15 天后，在下次打开 Search Files 时尝试更新（无常驻定时器），也可随时手动重建。
- **统一 fzf 搜索**：`Search Files` 只使用 fzf 对索引路径进行模糊、精确、前后缀、排除和 OR 匹配；输入搜索词不会执行 `fd`，也不再提供独立正则模式。
- **Finder 原生图标与文件操作**：显示文件夹及文件各自的 Finder 图标；支持打开、显示目录、快速预览与复制路径。
- **查看索引状态**：`Index Status` 查看索引构建时间、路径数量及搜索范围，并在 Finder 中打开真实的索引目录。
- **诊断信息**：`Debug Info` 自动获取 macOS、Raycast、Node.js 版本及索引文件完整性状态，可复制脱敏报告到 GitHub Issue。
- **可配置搜索范围**：多搜索目录、隐藏文件、软链接、排除模式。
- **后续功能**：直接从搜索结果让应用原有的 Open/Save 文件选择窗口跳转到目标文件或目录。

## 环境准备

- 已安装并登录 Raycast 的 macOS。
- Node.js **22.14 或更高版本**、npm **7 或更高版本**，以及 Git。
- 本机已安装 `fd` 与 `fzf`，例如 `brew install fd fzf`；也可以在插件设置里手动填写可执行文件绝对路径。

## 本地安装与加载

```bash
git clone https://github.com/juezhong/raycast-pathseek.git
cd raycast-pathseek
brew install fd fzf
npm install
npm run dev
```

执行 `npm run dev` 后，Raycast 会导入本地扩展并进入开发模式。在 Raycast 中按以下顺序测试：

1. **Index Status**：查看当前索引状态和真实磁盘保存位置；**不会触发扫描**。
2. **Rebuild Index**：首次手动建立索引。**建议先把 Search Roots 改成一个较小的目录**，例如 `~/Projects`，不要一开始就扫描整个用户目录。
3. **Search Files**：输入文件名、目录名或路径片段，在列表中选择结果并执行 Finder 相关操作。
4. **Debug Info**：发现错误时复制不含本地绝对路径的诊断报告，粘贴到 GitHub Issue。

**15 天更新规则**：索引满 15 天后，下次启动 Search Files 会尝试自动重建，不要求 Raycast 常驻。自动更新失败后 24 小时内不会自动重试；可随时手动重建获得最新文件。

### 插件配置

| 设置 | 功能 | 示例 |
| --- | --- | --- |
| Search Roots | 指定扫描根目录，使用分号或换行分隔；支持 `~` 展开 | `~/Projects;~/Downloads` |
| Include Hidden Files | 重建时是否包含隐藏文件/目录 | 默认关闭 |
| Follow Symbolic Links | 重建时是否跟随目录软链接 | 默认关闭 |
| Exclude Patterns | 逗号分隔的 `fd --exclude` 模式 | `.git,node_modules` |
| fd Executable / fzf Executable | 无法自动找到命令时指定其绝对路径 | `/opt/homebrew/bin/fd` |

修改上述扫描设置后，**必须手动重建索引**，新设置才会体现在搜索结果中。

## 持久化索引保存在哪里？

PathSeek 使用 Raycast 官方提供的 `environment.supportPath`，而不是存放在 GitHub 仓库或 Raycast 的加密 LocalStorage 数据库中。它的**绝对路径由 Raycast 在运行时决定**，不建议依赖某个写死的 `~/Library/...` 目录。

在 Raycast 执行 **Index Status → Open Index Directory in Finder** 即可打开该目录；也可以选择 **Copy Index Directory Path** 复制绝对路径。

```text
<environment.supportPath>/
├── index.nul              # 当前有效索引：元数据头 + NUL 分隔的绝对路径
├── index-<UUID>.nul.tmp   # 正在生成的新索引，构建成功后原子替换
├── index.json             # 旧版兼容文件，新版本不再使用其作为元数据来源
└── index-<UUID>.nul       # 升级时保留的旧索引（至少 24 小时）
```

索引文件包含本机绝对路径、项目名称和文件名，**不要直接上传至公开 GitHub Issue**。

新索引把构建时间、路径数量、搜索根目录和 NUL 路径数据存储于**同一个文件**，验证后用一次原子重命名替换 `index.nul`，不再存在数据和 `index.json` 两次提交的问题；跨进程锁仅协调多个建索引任务。原有 v1 索引可以读取，升级后旧文件会暂时保留。

完整的存储格式、手动构建流程、失败保护、查看方法与只读检查命令，请看：[索引存储与维护说明](docs/index-storage.md)。

### 搜索模式

Search Files 现在只有一个搜索框，使用 fzf 内置扩展搜索语法：`report` 模糊匹配、`'report` 精确包含、`.pdf$` 匹配 PDF 后缀、`!node_modules` 排除路径、`.ts$ | .tsx$` 表示二选一。**这不是完整正则表达式语法**（不支持 `.*` 或 `[a-z]+`）；搜索的是路径，不是文件内容。详见 [fzf 官方语法说明](https://junegunn.github.io/fzf/search-syntax/)。

## 技术设计与开发文档

| 文档 | 内容 |
| --- | --- |
| [架构与模块说明](docs/architecture.md) | 程序模块、控制流、数据流、设计取舍及局限 |
| [索引存储与维护说明](docs/index-storage.md) | 索引路径、元数据与 NUL 文件格式、构建/搜索机制 |
| [本地开发与调试](docs/development.md) | Raycast 安装、偏好设置、调试、错误排查 |
| [开发计划与验收](plans/pathseek-development/task_plan.md) | 开发阶段、任务状态、交付与验收 |
| [English README](README.md) | 英文使用说明 |

### 开发者专用 fd/fzf 调用追踪

在 Raycast 的 PathSeek 偏好设置里开启 **Developer: Trace fd/fzf Calls**（默认关闭），然后运行 **Rebuild Index** 或 Search Files 的 Fuzzy 模式；在 **Debug Info** 中查看调用时间、调用原因、参数结构、耗时、退出状态与匹配/索引条目数，并可复制脱敏报告。关闭后不会为正常搜索写入诊断日志。

详见 [开发者命令追踪说明](docs/developer-tracing.md) 与 [Issue #5 追踪验收](https://github.com/juezhong/raycast-pathseek/issues/5)。

## 测试与问题反馈

请使用 [Issue #1：初版安装与测试](https://github.com/juezhong/raycast-pathseek/issues/1) 与 [Issue #2：15 天更新、fzf 搜索及图标](https://github.com/juezhong/raycast-pathseek/issues/2)。

**你可以在 Issue 勾选已经验证通过的项目，或者直接在评论中贴出脱敏后的错误日志、复现步骤及建议。** 后续开发可以根据 Issue 的最新状态继续迭代。

本地构建检查：

```bash
npm run lint
npm run build
```

目前还没有基于 macOS 本机安装结果提交并验证的 `package-lock.json`；正式发布前需要补齐依赖锁文件、原创图标、自动化检查及 Raycast Store 审核材料。

## 当前开发进度

| 阶段 | 状态 |
| --- | --- |
| P1：上游审查和插件工程初始化 | 源码已提交，macOS 构建待验证 |
| P2：15 天按需刷新及索引安全清理 | 初始实现已提交，实机待验证 |
| P3：统一 fzf 搜索与原生 Finder 图标 | 初始实现已提交，实机待验证 |
| P4：原 Open/Save 对话框跳转 | 尚未实现 |
| P5：测试和 Raycast Store 发布 | 尚未开始 |

## 许可证

采用 [MIT License](LICENSE)。上游来源与版权通知见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。当前开发图标临时使用 MIT 许可的 Fuzzy File Search 上游资源，提交 Raycast Store 前需要更换为 PathSeek 原创图标。
