# PathSeek

[English](README.md) | [**简体中文**](README.zh-CN.md)

**PathSeek** 是一款基于 Raycast 的开源 macOS 文件搜索与路径导航插件，目标是提供接近 Windows Listary 的“输入文件名快速搜索、定位所在目录，以及在应用文件选择窗口中跳转”的体验。

> **当前为开发测试版。** 持久化索引、模糊搜索和 Finder 文件操作已提交初始实现，但**尚未完成 macOS 上的构建与 GUI 实测**。直接导航其他应用已弹出的 Open/Save 文件对话框（Dialog Bridge）**尚未开发**，请勿将其误认为已支持。

## 主要功能

- **可控持久化索引**：首次通过 `Rebuild Index` 使用 `fd` 构建；索引保存到本机。**超过 15 天后，下次打开 Search Files 时尝试刷新**，没有常驻定时服务；用户随时可手动重建。
- **模糊 + 正则搜索**：`Search Files` 提供 **Fuzzy (fzf)** 和 **Regex (full path)** 模式。搜索都在已有索引上进行；仅索引到期自动刷新或显式手动重建才启动 `fd`。
- **Finder 文件操作与原生图标**：结果显示 macOS Finder 文件/目录图标，支持打开文件、在 Finder 定位、打开所在目录、选择打开方式、快速预览、复制绝对路径。
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

**刷新规则**：首次需要手动构建；未满 15 天不自动刷新；满 15 天后，下次打开 Search Files 才尝试刷新（失败保留旧索引，并且 24 小时内不重复自动尝试）。不保证关闭 Raycast 时准时执行。新文件如需立刻可见，可手动 Rebuild Index。

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
├── index.json            # 当前索引元数据：文件名、构建时间、数量、扫描目录
├── index-<UUID>.nul      # 当前路径索引：绝对路径与 NUL 分隔符
└── index-<UUID>.nul      # 构建成功后通常只保留当前索引；异常中断可能残留临时/旧文件
```

索引文件包含本机绝对路径、项目名称和文件名，**不要直接上传至公开 GitHub Issue**。

当前版本使用跨进程锁防止并发重建；新索引成功提交并验证后才删除旧 `.nul` 文件；始终保留当前有效的索引。错误或中断期间可能留下临时文件。

完整的存储格式、手动构建流程、失败保护、查看方法与只读检查命令，请看：[索引存储与维护说明](docs/index-storage.md)。

### 搜索模式示例

在 Search Files 右侧选择 **Fuzzy (fzf)** 或 **Regex (full path)**：

- Fuzzy：输入 `linux 8250` 等片段，按路径模糊匹配。
- Regex：输入 `\\.tsx?# PathSeek

[English](README.md) | [**简体中文**](README.zh-CN.md)

**PathSeek** 是一款基于 Raycast 的开源 macOS 文件搜索与路径导航插件，目标是提供接近 Windows Listary 的“输入文件名快速搜索、定位所在目录，以及在应用文件选择窗口中跳转”的体验。

> **当前为开发测试版。** 持久化索引、模糊搜索和 Finder 文件操作已提交初始实现，但**尚未完成 macOS 上的构建与 GUI 实测**。直接导航其他应用已弹出的 Open/Save 文件对话框（Dialog Bridge）**尚未开发**，请勿将其误认为已支持。

## 主要功能

- **可控持久化索引**：首次通过 `Rebuild Index` 使用 `fd` 构建；索引保存到本机。**超过 15 天后，下次打开 Search Files 时尝试刷新**，没有常驻定时服务；用户随时可手动重建。
- **模糊 + 正则搜索**：`Search Files` 提供 **Fuzzy (fzf)** 和 **Regex (full path)** 模式。搜索都在已有索引上进行；仅索引到期自动刷新或显式手动重建才启动 `fd`。
- **Finder 文件操作与原生图标**：结果显示 macOS Finder 文件/目录图标，支持打开文件、在 Finder 定位、打开所在目录、选择打开方式、快速预览、复制绝对路径。
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

**刷新规则**：首次需要手动构建；未满 15 天不自动刷新；满 15 天后，下次打开 Search Files 才尝试刷新（失败保留旧索引，并且 24 小时内不重复自动尝试）。不保证关闭 Raycast 时准时执行。新文件如需立刻可见，可手动 Rebuild Index。

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
├── index.json            # 当前索引元数据：文件名、构建时间、数量、扫描目录
├── index-<UUID>.nul      # 当前路径索引：绝对路径与 NUL 分隔符
└── index-<UUID>.nul      # 构建成功后通常只保留当前索引；异常中断可能残留临时/旧文件
```

索引文件包含本机绝对路径、项目名称和文件名，**不要直接上传至公开 GitHub Issue**。

当前版本使用跨进程锁防止并发重建；新索引成功提交并验证后才删除旧 `.nul` 文件；始终保留当前有效的索引。错误或中断期间可能留下临时文件。

完整的存储格式、手动构建流程、失败保护、查看方法与只读检查命令，请看：[索引存储与维护说明](docs/index-storage.md)。

 查找 `.ts` / `.tsx` 路径，或 `src/.*/config` 匹配完整路径。
- 正则遵循 JavaScript RegExp 语法、忽略大小写；仅搜索路径字符串，不搜索文件内容。
- 无效正则显示错误提示，不会修改本地索引。

## 技术设计与开发文档

| 文档 | 内容 |
| --- | --- |
| [架构与模块说明](docs/architecture.md) | 程序模块、控制流、数据流、设计取舍及局限 |
| [索引存储与维护说明](docs/index-storage.md) | 索引路径、元数据与 NUL 文件格式、构建/搜索机制 |
| [本地开发与调试](docs/development.md) | Raycast 安装、偏好设置、调试、错误排查 |
| [开发计划与验收](plans/pathseek-development/task_plan.md) | 开发阶段、任务状态、交付与验收 |
| [English README](README.md) | 英文使用说明 |

## 测试与问题反馈

请使用 [Issue #1：安装、初版测试](https://github.com/juezhong/raycast-pathseek/issues/1) 和 [Issue #2：15 天索引更新、正则搜索、文件图标验收](https://github.com/juezhong/raycast-pathseek/issues/2)。

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
| P2：15 天按需刷新、手动重建、索引保护与清理 | 初始实现已提交，实机待验证 |
| P3：fzf / 正则搜索及 Finder 原生图标 | 初始实现已提交，实机待验证 |
| P4：原 Open/Save 对话框跳转 | 尚未实现 |
| P5：测试和 Raycast Store 发布 | 尚未开始 |

## 许可证

采用 [MIT License](LICENSE)。上游来源与版权通知见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。当前开发图标临时使用 MIT 许可的 Fuzzy File Search 上游资源，提交 Raycast Store 前需要更换为 PathSeek 原创图标。
