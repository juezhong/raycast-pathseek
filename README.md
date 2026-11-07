# PathSeek

**macOS + Raycast 本地扩展。仅通过本地源码安装和维护，不发布到 Raycast Store。**

PathSeek 用于在 macOS 的 **Open/Save（打开/保存）对话框**中，快速查找文件或目录，然后将完整路径粘贴回原应用；也可以在 Raycast 中搜索文件、复制路径或使用 Finder 打开。

搜索基于本地压缩索引。**只有主动执行 Build Index 才会运行 `fd` 扫描；每次查询按需运行 `fzf`，没有常驻搜索服务、定时扫描或完整索引内存缓存。**

## 1. 环境准备

- macOS 与 [Raycast](https://www.raycast.com/)（需要登录才能使用 **Import Extension**）。
- Node.js **22.14+**（本项目 macOS CI 验证 Node.js 22/24）；建议通过个人已有的 Node 版本管理器使用。
- npm、`git`、`fd` 和 `fzf`。

```bash
brew install fd fzf

node --version
fd --version
fzf --version
```

`fd` 负责**手动扫描**，`fzf` 负责**按需搜索**；扩展不会自动安装或后台启动这些工具。

## 2. 首次本地安装

选择一个**长期保留、不随意移动或删除**的源码目录：

```bash
git clone --single-branch --branch main \
  https://github.com/juezhong/raycast-pathseek.git

cd raycast-pathseek
npm ci
npm test
npm run build
```

`npm ci` 安装锁定版本依赖；`npm test` 检查索引、子进程清理等行为；`npm run build` 生成并验证 Raycast 扩展构建。**构建成功不等于已经导入 Raycast。**

### 在 Raycast 中手动导入（推荐）

1. 打开 **Raycast 应用**，按 `⌘ ,` 进入 **Settings（设置）**，找到 **Extensions（扩展）**。
2. 在扩展管理界面的右上角菜单 `⋯`（部分 Raycast 版本显示为 `+`）中选择 **Import Extension**；也可在 Raycast **主搜索框**直接搜索 `Import Extension` 并按回车执行。
3. 文件夹选择框中选中刚克隆的 **`raycast-pathseek/` 仓库根目录**。该目录应直接包含 `package.json` 和 `src/`，**不要选择 `dist/`、`src/` 或 `assets/`**。
4. 导入完成后，在 Raycast 主搜索框中搜索 **Build Index** 或 **Find in Open/Save**；也可在 **Settings → Extensions** 中检查 **PathSeek**，然后为 **Find in Open/Save** 设置快捷键。

**注意：** `npm run build` 只验证构建，并不等于已安装。Raycast 官方的开发者命令要求登录 Raycast 账号；如找不到 **Import Extension**，请先确认已登录账号。

### 找不到 Import Extension 时：命令行自动导入

在仓库根目录执行：

```bash
npm run dev
```

`ray develop` 会**自动导入尚未导入的源码扩展**。看到 PathSeek 命令出现在 Raycast 后，返回终端按 `Ctrl+C` 结束开发模式。Raycast 官方确认：**结束开发进程后，本地扩展仍保留在 Raycast，可通过主搜索继续打开。** 这不是 Store 发布，也不要求终端长期运行。

需要区分：执行 `npm run dev` 时扩展处于开发模式，其索引存放在独立的 `index-development-v3/` 下；正常本地使用模式的索引位置不同。第一次切换模式后可能需要在对应模式下重新执行一次 **Build Index**。不要因为搜索不到旧索引就卸载扩展。

**日常使用不需要一直运行 `npm run dev` 或保持终端打开。** 只有修改源码或排查问题时才需要开发模式。Raycast 宿主自身的进程生命周期由 Raycast 管理，PathSeek 不额外启动守护进程。

官方参考：[Raycast Getting Started](https://developers.raycast.com/basics/getting-started)、[Raycast CLI](https://developers.raycast.com/information/developer-tools/cli)、[Raycast Extensions](https://manual.raycast.com/extensions)。

## 3. 首次建索引（只需主动操作一次）

1. 在 Raycast 执行 **Build Index**，选择希望搜索的 **Index Folders**（如家目录）。
2. 可选：设置 **Symlink Shortcut Folder**，即专门存放目录软链接的真实目录（如 `~/Symlinks`）。
3. 确认后主动执行建立索引；首次构建完成前，搜索不会自动扫描文件系统。
4. 用 **View Index Status** 检查索引的路径数、构建时间和体积。

索引默认采用 **v3 前缀编码 + Brotli 压缩**，保存在 Raycast 扩展自己的支持目录。索引文件在完整构建成功后才原子替换；正常取消或失败应保留上一次成功的索引。

**开发与日常模式隔离：**通过 `npm run dev` 启动时会使用独立的 `index-development-v3/` 目录，而正常导入使用非开发模式索引目录。若你之前只在开发模式构建索引，第一次改为日常导入方式使用时可能需要重新建立一次正式索引；此后更新代码不需要反复卸载和重建。

**软链接规则：**普通扫描不启用 `fd --follow`；只有指定快捷目录的**直接子项中指向目录的软链接**会被单独展开。搜索结果保留快捷链接路径，其目标内部的软链接不会继续跟随。

可在 Raycast 的扩展偏好设置里配置 `Include Hidden Files`、排除规则、Brotli 等级及 `fd`/`fzf` 可执行文件路径。修改扫描配置后需要**主动重建**，已有索引不会自动刷新。

## 4. 日常使用

- **Find in Open/Save**：在其他应用中打开文件选择对话框，通过你设置的 Raycast 热键调用 PathSeek，搜索并执行 **Select File or Go to Folder (Paste Full Path)**。若目标应用不接受直接粘贴，先回到原对话框按 `⌘⇧G`（前往文件夹）再尝试。扩展只辅助输入路径，不自动点击“打开”或“保存”。
- **Search Indexed Files**：搜索文件名、目录名或路径，可在 Finder 中定位、打开、预览或复制绝对路径。
- **Build Index**：只有需要包含新增/移动/删除的文件时才手动重建；支持 **Cancel Index Build**。
- **View Index Status**：检查索引状态、时间和文件位置。
- **View Diagnostics**：排查错误时查看脱敏信息。开发者 `fd/fzf` 调用追踪默认关闭。

**设计取舍：**每次搜索按需读取压缩索引并启动一次 `fzf`；结束或取消后应关闭读取流并回收子进程。它不把解压后的全部文件路径常驻内存。对间隔数分钟或数十分钟的低频使用方式，优先控制空闲资源和可靠性，而非追求极低的连续查询延迟。

## 5. 更新本地安装

在**原来的克隆目录**更新源码，不要每次卸载和重新克隆：

```bash
cd /path/to/raycast-pathseek
git switch main
git pull --ff-only origin main
npm ci
npm test
npm run build
```

已导入的本地扩展由用户自行维护，**不会通过 Raycast Store 自动更新**。如果更新构建后命令没有反映新代码，可在 Raycast 重新执行 **Import Extension**，选择同一个仓库目录，或临时使用 `npm run dev` 排查；完成调试后关闭开发模式。

**不要将扩展卸载当成日常更新方式。** 卸载可能清除 Raycast 扩展的支持数据（包含你主动构建的索引）；仅更新本地源码和重新构建，不需要刻意删除索引。

## 6. 稳定性验收与资源检查

本项目 CI 覆盖 macOS、Node.js 22/24、单元测试、真实 `fd`/`fzf` 集成测试、Raycast 构建、类型检查和格式检查。**CI 通过不代替真实 macOS Open/Save 对话框的人工验收。**

建议首次导入后执行：

1. 在 **Build Index** 完成一次正常构建，在 **View Index Status** 确认索引有效。
2. 在 **Search Indexed Files** 搜索一个确实存在的文件，随后清空搜索框并退出命令；连续重复数次，确认结果和界面正常。
3. 在实际应用的 Open/Save 对话框测试 **Find in Open/Save** 的路径粘贴及 `⌘⇧G` 回退流程。
4. 观察退出搜索后是否仍存在**由本次 PathSeek 启动**的 `fzf`。如果系统同时运行其他 `fzf`/`fd`，不要直接凭进程名认定是 PathSeek 遗留进程。

**可选取消测试（注意影响）：**如果要验证重建中断，请先用 **View Index Status → Copy Active Index File Path** 找到现有 `index.nul`，并将其复制到 Raycast 支持目录之外作为备份，然后主动开始重建、点击 **Cancel Index Build**，再次确认原索引仍可搜索。备份索引中包含可恢复的私人文件路径，须妥善保管。不要在尚无有效索引时用取消测试代替首次构建。

出现异常时，提供脱敏后的 **View Diagnostics** 以及相关错误码；不要公开上传 `index.nul`、完整绝对路径或包含个人文件名的原始日志。

## 7. 问题排查

| 情况 | 检查方法 |
| --- | --- |
| Raycast 中找不到 PathSeek | 先在 Raycast 主搜索框输入 `Import Extension`，或在 **Settings → Extensions** 的右上角菜单找导入选项；仍找不到则执行一次 `npm run dev` 自动导入 |
| 构建成功但无法搜索 | 确认已在 **Build Index** 主动完成首次索引 |
| 找不到 `fd` 或 `fzf` | 执行 `command -v fd` 和 `command -v fzf`；必要时在扩展偏好里填写绝对路径 |
| 文件新增后搜索不到 | 正常行为；索引不会后台自动更新，需手动 **Build Index** |
| Open/Save 不能直接接受粘贴路径 | 在目标对话框按 `⌘⇧G` 打开“前往文件夹”再尝试 |
| 卸载后索引消失 | 导入本地源码并重新 **Build Index**；以后更新源码时不要卸载 |

## 8. 开发与维护

```bash
npm test
npm run build
npm run lint:code
npm run format:check

# 仅开发调试时
npm run dev

# 可选：主动运行一次独立基准测试；创建并清理自己的临时索引
npm run benchmark:standalone -- "$HOME" --hidden --quality 7 --runs 5
```

基准测试不会自动启动，也不会安装常驻服务；日常使用无需运行。任何额外 CPU/GPU 实验均不属于 `main` 的默认搜索实现。

## 许可

MIT License。PathSeek 基于 Raycast [Fuzzy File Search](https://github.com/raycast/extensions/tree/main/extensions/fuzzy-file-search) 的 MIT 许可代码进行扩展。版权及第三方许可请参阅 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
