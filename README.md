# PathSeek

**macOS + Raycast 本地扩展。仅通过本地源码安装和维护，不发布到 Raycast Store。**

PathSeek 用于在 macOS 的 **Open/Save（打开/保存）对话框**中，快速查找文件或目录，然后将完整路径粘贴回原应用；也可以在 Raycast 中搜索文件、复制路径或使用 Finder 打开。

搜索基于本地压缩索引。**只有主动执行 Build Index 才会运行 `fd` 扫描；每次查询按需运行 `fzf`，没有常驻搜索服务、定时扫描或完整索引内存缓存。**

## 1. 环境准备

- macOS 与 [Raycast](https://www.raycast.com/)（请登录 Raycast 账号，以便使用扩展开发者命令）。
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

### 本地安装：命令行自动导入（推荐）

你使用的 Raycast 版本在 **Settings → Extensions → +** 中没有 `Import Extension`，因此不要再寻找这个菜单。**在已克隆并完成 `npm ci` 的仓库根目录执行：**

```bash
npm run dev
```

这是 Raycast 官方的 `ray develop` 命令，会把尚未导入的本地扩展注册到 Raycast，同时临时启动开发热重载。具体操作：

1. 终端运行上述命令，确认没有启动错误。
2. 打开 **Raycast 主搜索框**，搜索 `PathSeek`、`Build Index` 或 `Find in Open/Save`；确认命令出现。
3. 回到终端按 **`Ctrl+C`** 停止热重载。**官方文档确认：命令停止后，本地扩展仍会保留在 Raycast 中供搜索和使用**，不要求终端一直运行，也不会发布 Store。
4. 在 **Raycast Settings → Extensions** 中找到 PathSeek，为 `Find in Open/Save` 设置快捷键；首次使用时主动执行一次 `Build Index`。

`npm run build` 只验证可构建，**不会自动导入扩展**。此项目目前优先采用 CLI 导入，避免依赖不同 Raycast 版本中的菜单位置。

PathSeek 统一使用 Raycast 提供的 `environment.supportPath` 作为索引存储根目录，**不会因为 `npm run dev`、退出调试或本地扩展的开发模式标志而切换目录**。通过 `View Index Status → Copy Active Index File Path` 可以查看当前真实索引路径；日常更新不需要卸载扩展或删除索引。

若后续版本的 Raycast 提供 `Import Extension` 命令，也可以用它选择含 `package.json` 的仓库根目录；但对你当前的界面，不把它作为必需步骤。

官方参考：[Raycast Getting Started](https://developers.raycast.com/basics/getting-started)、[Raycast CLI](https://developers.raycast.com/information/developer-tools/cli)、[Raycast Extensions](https://manual.raycast.com/extensions)。

## 3. 首次建索引（只需主动操作一次）

1. 在 Raycast 执行 **Build Index**，选择希望搜索的 **Index Folders**（如家目录）。
2. 可选：设置 **Symlink Shortcut Folder**，即专门存放目录软链接的真实目录（如 `~/Symlinks`）。
3. 确认后主动执行建立索引；首次构建完成前，搜索不会自动扫描文件系统。
4. 用 **View Index Status** 检查索引的路径数、构建时间和体积。

索引默认采用 **v3 前缀编码 + Brotli 压缩**，保存在 Raycast 扩展自己的支持目录（通常位于 `~/Library/Application Support/com.raycast.macos/extensions/` 的某个扩展子目录，由 Raycast 决定具体位置）。**这是插件数据目录，而不是 Git 源码目录或可执行文件资源包**。索引文件在完整构建成功后才原子替换；正常取消或失败应保留上一次成功的索引。

**统一目录与旧索引兼容：**新版本始终在 `environment.supportPath/index.nul` 建立和读取索引。如果这个位置没有有效索引，仍可**只读**使用历史 `environment.supportPath/index-development-v3/index.nul`；`View Index Status` 会明确提示旧位置。下一次你主动执行 `Build Index` 才在统一目录生成新索引，**不会自动删除或覆盖旧目录**。如果两个位置都有索引，统一目录优先。

**清理旧索引：**只有在 `View Index Status → Copy Active Index File Path` 已显示统一目录中的 `index.nul`，并且搜索功能验收通过后，才考虑在 Finder 中备份并删除**旧的 `index-development-v3` 子目录**。请勿删除整个 `environment.supportPath`；其中可能还有当前索引、构建进度和日志。为避免误操作，PathSeek 不会自动清除旧目录。

**软链接规则：**普通扫描不启用 `fd --follow`；只有指定快捷目录的**直接子项中指向目录的软链接**会被单独展开。搜索结果保留快捷链接路径，其目标内部的软链接不会继续跟随。

可在 Raycast 的扩展偏好设置里配置 `Include Hidden Files`、排除规则、Brotli 等级及 `fd`/`fzf` 可执行文件路径。修改扫描配置后需要**主动重建**，已有索引不会自动刷新。

### 配置保存在哪里？

PathSeek **没有单独的 `config.json` 配置文件**，所以不能从 `index.nul` 旁边找到完整配置。Raycast 管理以下两类持久化数据：

| 配置 | 读取与保存方式 | 用户从哪里修改 |
| --- | --- | --- |
| 要扫描的根目录 | Raycast `LocalStorage`，键为 `configured-index-roots-v1` | `Build Index → Change Indexed Folders` |
| 软链接快捷目录 | Raycast `LocalStorage`，键为 `configured-selective-symlink-folder-v1` | 同一个文件夹选择界面 |
| 是否包含隐藏文件、排除规则、压缩等级、fd/fzf 路径及调试开关 | `getPreferenceValues()`，其配置项定义在 `package.json` | `Raycast Settings → Extensions → PathSeek` |

以上由 Raycast 管理的配置**不等于**磁盘上的压缩索引。Raycast 的 `LocalStorage` 在本地加密数据库中，不是放在插件支持目录下的普通文本文件。索引 `index.nul` 的头部会另存**上一次成功构建时**的根目录快照，但不是设置的唯一来源。

**取消/失败与清理规则：**

- 主动取消或普通构建错误：关闭 `fd` 与压缩管道，删除本次 `index-UUID.nul.tmp`；不会发布半成品，已发布的 `index.nul` 保持原样。
- 允许正常执行退出钩子的进程退出：额外尝试同步清理尚未完成的暂存文件。
- `SIGKILL`、Raycast 强制终止执行线程或系统断电：无法保证立即清理；**下一次主动执行 Build Index、获得独占构建锁后**，会回收遗留的 UUID 暂存文件及进度临时文件。不会在平时搜索时自动启动清理任务。
- `build-progress.json` 是扫描数值和 `cancelled` / `failed` 结果的诊断记录，**不是路径缓存索引**；它可以保留以方便排查。
- 删除不涉及 Raycast `LocalStorage`、Preferences、已发布的 `index.nul` 或其它用户文件。主动保存的新目录配置即使随后取消构建，也会保持已保存状态。

## 4. 日常使用

- **Find in Open/Save**：在其他应用中打开文件选择对话框，通过你设置的 Raycast 热键调用 PathSeek，搜索并执行 **Select File or Go to Folder (Paste Full Path)**。若目标应用不接受直接粘贴，先回到原对话框按 `⌘⇧G`（前往文件夹）再尝试。扩展只辅助输入路径，不自动点击“打开”或“保存”。
- **Search Indexed Files**：默认仅对每条索引记录的文件名/目录名（basename）匹配；结果仍携带完整绝对路径，可在 Finder 中定位、打开、预览或复制。
- **Build Index**：只有需要包含新增/移动/删除的文件时才手动重建；支持 **Cancel Index Build**。
- **View Index Status**：检查索引状态、时间和文件位置。
- **View Diagnostics**：排查错误时查看脱敏信息。开发者 `fd/fzf` 调用追踪默认关闭。

### 名称匹配、拼音搜索与表达式帮助

**不含 `/` 的普通查询**仅匹配每条索引记录自身的文件/目录名，不会因为父目录匹配而把无关文件也显示出来。例如搜索 `2026 dyc` 需要同一个文件或目录名称中同时满足 `2026` 和“第一次”的拼音首字母；`/2026/第一次.txt` 不满足此条件，但 `/docs/2026第一次.txt` 可以匹配。**显示仍保留完整路径，并可正常粘贴到 Open/Save 对话框**。

PathSeek 继续使用原生 `fzf --extended --read0 --print0 --filter` 和 `--nth=1` 限制匹配字段，保留常用 fzf 操作符：

- `driver`：按字符顺序模糊匹配名称；`'driver`：精确包含。
- `^driver`：名称以 driver 开头；`.pdf$`：名称以 .pdf 结尾。
- `!tmp`：排除名称中包含 tmp 的结果；`driver .c$`：AND；`.c$ | .h$`：OR。

**带 `/` 的查询进入多级路径模糊模式**。把每个 `/` 视作一个目录层级分隔符；前面的各段独立模糊匹配**连续的父目录名称**，最后一段继续用原生 fzf 匹配实际文件/目录名。可以省略前面不关心的祖先目录，不要求输入完整名称。例如 `/first/second/third/fourth` 中的 fourth，可通过 `th/for`、`third/fou`、`fir/seco/th/four` 查到。`th/` 可以列出名称匹配 `th` 的目录下的**直接子项**，`src/.c$` 可以在名称模糊匹配 `src` 的目录下查找 `.c` 结尾的文件。中间层级不能跳过：`first/third/four` 不会越过 `second`。

**目录段与末级名称的匹配语法：**目录段现在也支持 `fzf` 风格的智能大小写（全小写忽略大小写，含大写字母则区分大小写）、`'` 精确包含、`^` 前缀、`$` 后缀、`!` 排除以及空格 AND、独立 `|` OR。例如 `^Src/lib/.c$` 只在名称以大写 `Src` 开头的目录中匹配 `.c` 文件，`!test/src/file` 可排除匹配 `test` 的父目录。无运算符的多级模糊路径查询将连续父目录与末级名称的可搜索字段交给**原生 fzf** 评分与排序，同时轻量校验各目录段，避免跨层级误命中；包含 Extended Search 运算符时继续使用逐段兼容过滤，并由 fzf 负责末级匹配。不增加 fzf 子进程，拼音别名仅在当前查询期间计算和缓存。

**语法边界：**`fzf` Extended Search **不是完整正则表达式**，因此 `a.*b` 不会被解释为任意字符重复的 Regex。只有 `/` 激活路径模式；包含 `\\`、空格、`^`、`$` 等但不含 `/` 的查询，仍按原有文件/目录名模式处理。普通多级模糊路径使用 fzf 的路径评分；扩展运算符路径保留逐段布尔条件和末级 fzf 排序，两者不保证完全相同的评分顺序。

目录段也使用动态拼音首字母和全拼，例如 `第一次/第二次.txt` 可以使用 `dyc/dec` 查找，但不会把不同目录层的字符跨级拼接成一个词。匹配出来的项目仍保留可供 Open/Save 粘贴的**完整绝对路径**。多级查询是对已有索引的单次流式过滤，不会启动 `fd` 扫描、产生第二份索引或后台驻留；但目录模糊判断会增加部分 CPU 工作，重复目录的拼音别名在单次查询期间使用有限容量缓存。

所有查询始终支持可识别中文名称的拼音首字母与全拼，例如“第一次”可用 `dyc`、`yc d`、`diyici`，“第二次”可用 `dec`、`derc`、`d erc`、`d er c`。拼音通过字典动态生成，没有为个别名称硬编码规则。为避免常见英文名称挤掉中文拼音结果，在维持最多 150 条展示及固定内存上限的前提下，会为拼音命中的中文名称预留一部分结果名额；对超宽泛查询仍有扫描条数上限。带有 `!`、`^`、`# PathSeek

**macOS + Raycast 本地扩展。仅通过本地源码安装和维护，不发布到 Raycast Store。**

PathSeek 用于在 macOS 的 **Open/Save（打开/保存）对话框**中，快速查找文件或目录，然后将完整路径粘贴回原应用；也可以在 Raycast 中搜索文件、复制路径或使用 Finder 打开。

搜索基于本地压缩索引。**只有主动执行 Build Index 才会运行 `fd` 扫描；每次查询按需运行 `fzf`，没有常驻搜索服务、定时扫描或完整索引内存缓存。**

## 1. 环境准备

- macOS 与 [Raycast](https://www.raycast.com/)（请登录 Raycast 账号，以便使用扩展开发者命令）。
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

### 本地安装：命令行自动导入（推荐）

你使用的 Raycast 版本在 **Settings → Extensions → +** 中没有 `Import Extension`，因此不要再寻找这个菜单。**在已克隆并完成 `npm ci` 的仓库根目录执行：**

```bash
npm run dev
```

这是 Raycast 官方的 `ray develop` 命令，会把尚未导入的本地扩展注册到 Raycast，同时临时启动开发热重载。具体操作：

1. 终端运行上述命令，确认没有启动错误。
2. 打开 **Raycast 主搜索框**，搜索 `PathSeek`、`Build Index` 或 `Find in Open/Save`；确认命令出现。
3. 回到终端按 **`Ctrl+C`** 停止热重载。**官方文档确认：命令停止后，本地扩展仍会保留在 Raycast 中供搜索和使用**，不要求终端一直运行，也不会发布 Store。
4. 在 **Raycast Settings → Extensions** 中找到 PathSeek，为 `Find in Open/Save` 设置快捷键；首次使用时主动执行一次 `Build Index`。

`npm run build` 只验证可构建，**不会自动导入扩展**。此项目目前优先采用 CLI 导入，避免依赖不同 Raycast 版本中的菜单位置。

PathSeek 统一使用 Raycast 提供的 `environment.supportPath` 作为索引存储根目录，**不会因为 `npm run dev`、退出调试或本地扩展的开发模式标志而切换目录**。通过 `View Index Status → Copy Active Index File Path` 可以查看当前真实索引路径；日常更新不需要卸载扩展或删除索引。

若后续版本的 Raycast 提供 `Import Extension` 命令，也可以用它选择含 `package.json` 的仓库根目录；但对你当前的界面，不把它作为必需步骤。

官方参考：[Raycast Getting Started](https://developers.raycast.com/basics/getting-started)、[Raycast CLI](https://developers.raycast.com/information/developer-tools/cli)、[Raycast Extensions](https://manual.raycast.com/extensions)。

## 3. 首次建索引（只需主动操作一次）

1. 在 Raycast 执行 **Build Index**，选择希望搜索的 **Index Folders**（如家目录）。
2. 可选：设置 **Symlink Shortcut Folder**，即专门存放目录软链接的真实目录（如 `~/Symlinks`）。
3. 确认后主动执行建立索引；首次构建完成前，搜索不会自动扫描文件系统。
4. 用 **View Index Status** 检查索引的路径数、构建时间和体积。

索引默认采用 **v3 前缀编码 + Brotli 压缩**，保存在 Raycast 扩展自己的支持目录（通常位于 `~/Library/Application Support/com.raycast.macos/extensions/` 的某个扩展子目录，由 Raycast 决定具体位置）。**这是插件数据目录，而不是 Git 源码目录或可执行文件资源包**。索引文件在完整构建成功后才原子替换；正常取消或失败应保留上一次成功的索引。

**统一目录与旧索引兼容：**新版本始终在 `environment.supportPath/index.nul` 建立和读取索引。如果这个位置没有有效索引，仍可**只读**使用历史 `environment.supportPath/index-development-v3/index.nul`；`View Index Status` 会明确提示旧位置。下一次你主动执行 `Build Index` 才在统一目录生成新索引，**不会自动删除或覆盖旧目录**。如果两个位置都有索引，统一目录优先。

**清理旧索引：**只有在 `View Index Status → Copy Active Index File Path` 已显示统一目录中的 `index.nul`，并且搜索功能验收通过后，才考虑在 Finder 中备份并删除**旧的 `index-development-v3` 子目录**。请勿删除整个 `environment.supportPath`；其中可能还有当前索引、构建进度和日志。为避免误操作，PathSeek 不会自动清除旧目录。

**软链接规则：**普通扫描不启用 `fd --follow`；只有指定快捷目录的**直接子项中指向目录的软链接**会被单独展开。搜索结果保留快捷链接路径，其目标内部的软链接不会继续跟随。

可在 Raycast 的扩展偏好设置里配置 `Include Hidden Files`、排除规则、Brotli 等级及 `fd`/`fzf` 可执行文件路径。修改扫描配置后需要**主动重建**，已有索引不会自动刷新。

### 配置保存在哪里？

PathSeek **没有单独的 `config.json` 配置文件**，所以不能从 `index.nul` 旁边找到完整配置。Raycast 管理以下两类持久化数据：

| 配置 | 读取与保存方式 | 用户从哪里修改 |
| --- | --- | --- |
| 要扫描的根目录 | Raycast `LocalStorage`，键为 `configured-index-roots-v1` | `Build Index → Change Indexed Folders` |
| 软链接快捷目录 | Raycast `LocalStorage`，键为 `configured-selective-symlink-folder-v1` | 同一个文件夹选择界面 |
| 是否包含隐藏文件、排除规则、压缩等级、fd/fzf 路径及调试开关 | `getPreferenceValues()`，其配置项定义在 `package.json` | `Raycast Settings → Extensions → PathSeek` |

以上由 Raycast 管理的配置**不等于**磁盘上的压缩索引。Raycast 的 `LocalStorage` 在本地加密数据库中，不是放在插件支持目录下的普通文本文件。索引 `index.nul` 的头部会另存**上一次成功构建时**的根目录快照，但不是设置的唯一来源。

**取消/失败与清理规则：**

- 主动取消或普通构建错误：关闭 `fd` 与压缩管道，删除本次 `index-UUID.nul.tmp`；不会发布半成品，已发布的 `index.nul` 保持原样。
- 允许正常执行退出钩子的进程退出：额外尝试同步清理尚未完成的暂存文件。
- `SIGKILL`、Raycast 强制终止执行线程或系统断电：无法保证立即清理；**下一次主动执行 Build Index、获得独占构建锁后**，会回收遗留的 UUID 暂存文件及进度临时文件。不会在平时搜索时自动启动清理任务。
- `build-progress.json` 是扫描数值和 `cancelled` / `failed` 结果的诊断记录，**不是路径缓存索引**；它可以保留以方便排查。
- 删除不涉及 Raycast `LocalStorage`、Preferences、已发布的 `index.nul` 或其它用户文件。主动保存的新目录配置即使随后取消构建，也会保持已保存状态。

## 4. 日常使用

- **Find in Open/Save**：在其他应用中打开文件选择对话框，通过你设置的 Raycast 热键调用 PathSeek，搜索并执行 **Select File or Go to Folder (Paste Full Path)**。若目标应用不接受直接粘贴，先回到原对话框按 `⌘⇧G`（前往文件夹）再尝试。扩展只辅助输入路径，不自动点击“打开”或“保存”。
- **Search Indexed Files**：默认仅对每条索引记录的文件名/目录名（basename）匹配；结果仍携带完整绝对路径，可在 Finder 中定位、打开、预览或复制。
- **Build Index**：只有需要包含新增/移动/删除的文件时才手动重建；支持 **Cancel Index Build**。
- **View Index Status**：检查索引状态、时间和文件位置。
- **View Diagnostics**：排查错误时查看脱敏信息。开发者 `fd/fzf` 调用追踪默认关闭。

### 名称匹配、拼音搜索与表达式帮助

**不含 `/` 的普通查询**仅匹配每条索引记录自身的文件/目录名，不会因为父目录匹配而把无关文件也显示出来。例如搜索 `2026 dyc` 需要同一个文件或目录名称中同时满足 `2026` 和“第一次”的拼音首字母；`/2026/第一次.txt` 不满足此条件，但 `/docs/2026第一次.txt` 可以匹配。**显示仍保留完整路径，并可正常粘贴到 Open/Save 对话框**。

PathSeek 继续使用原生 `fzf --extended --read0 --print0 --filter` 和 `--nth=1` 限制匹配字段，保留常用 fzf 操作符：

- `driver`：按字符顺序模糊匹配名称；`'driver`：精确包含。
- `^driver`：名称以 driver 开头；`.pdf$`：名称以 .pdf 结尾。
- `!tmp`：排除名称中包含 tmp 的结果；`driver .c$`：AND；`.c$ | .h$`：OR。

**带 `/` 的查询进入多级路径模糊模式**。把每个 `/` 视作一个目录层级分隔符；前面的各段独立模糊匹配**连续的父目录名称**，最后一段继续用原生 fzf 匹配实际文件/目录名。可以省略前面不关心的祖先目录，不要求输入完整名称。例如 `/first/second/third/fourth` 中的 fourth，可通过 `th/for`、`third/fou`、`fir/seco/th/four` 查到。`th/` 可以列出名称匹配 `th` 的目录下的**直接子项**，`src/.c$` 可以在名称模糊匹配 `src` 的目录下查找 `.c` 结尾的文件。中间层级不能跳过：`first/third/four` 不会越过 `second`。

**目录段与末级名称的匹配语法：**目录段现在也支持 `fzf` 风格的智能大小写（全小写忽略大小写，含大写字母则区分大小写）、`'` 精确包含、`^` 前缀、`$` 后缀、`!` 排除以及空格 AND、独立 `|` OR。例如 `^Src/lib/.c$` 只在名称以大写 `Src` 开头的目录中匹配 `.c` 文件，`!test/src/file` 可排除匹配 `test` 的父目录。无运算符的多级模糊路径查询将连续父目录与末级名称的可搜索字段交给**原生 fzf** 评分与排序，同时轻量校验各目录段，避免跨层级误命中；包含 Extended Search 运算符时继续使用逐段兼容过滤，并由 fzf 负责末级匹配。不增加 fzf 子进程，拼音别名仅在当前查询期间计算和缓存。

**语法边界：**`fzf` Extended Search **不是完整正则表达式**，因此 `a.*b` 不会被解释为任意字符重复的 Regex。只有 `/` 激活路径模式；包含 `\\`、空格、`^`、`$` 等但不含 `/` 的查询，仍按原有文件/目录名模式处理。普通多级模糊路径使用 fzf 的路径评分；扩展运算符路径保留逐段布尔条件和末级 fzf 排序，两者不保证完全相同的评分顺序。

目录段也使用动态拼音首字母和全拼，例如 `第一次/第二次.txt` 可以使用 `dyc/dec` 查找，但不会把不同目录层的字符跨级拼接成一个词。匹配出来的项目仍保留可供 Open/Save 粘贴的**完整绝对路径**。多级查询是对已有索引的单次流式过滤，不会启动 `fd` 扫描、产生第二份索引或后台驻留；但目录模糊判断会增加部分 CPU 工作，重复目录的拼音别名在单次查询期间使用有限容量缓存。

所有查询始终支持可识别中文名称的拼音首字母与全拼，例如“第一次”可用 `dyc`、`yc d`、`diyici`，“第二次”可用 `dec`、`derc`、`d erc`、`d er c`。拼音通过字典动态生成，没有为个别名称硬编码规则。为避免常见英文名称挤掉中文拼音结果，在维持最多 150 条展示及固定内存上限的前提下，会为拼音命中的中文名称预留一部分结果名额；对超宽泛查询仍有扫描条数上限。、`'` 或 `|` 等 fzf 运算符的查询仍保留原名匹配及语法含义，并可在拼音别名上匹配；结果按真实路径去重。多音字、专有名词可能有读音歧义。若搜索不到，先用 `'第二次` 这样的原文精确包含表达式核对名称是否已在索引中；若索引过期，需手动 Build Index。

通过搜索界面的 `⌘K` 可用：

- **Search Syntax Help**：内置搜索语法说明，不需要打开网页。
- **Compose Expression & Preview**：在表单填写表达式，按当前索引预览最多五条匹配结果，回车后将表达式应用到主搜索。

索引文件仍是原来的 `index.nul`，没有第二份拼音索引、自动扫描或常驻后台任务。**名称字段与拼音别名按需流式生成**；相比旧的完整路径匹配，查询会有额外字符串处理和可能的拼音 CPU 开销，尤其在大型索引中应实际测量搜索延迟。

### 搜索性能基准（只读）

使用已存在的压缩索引测量完整流式搜索，包含磁盘读取、解压、目录过滤、拼音及 `fzf` 子进程。打开 Raycast 的 **View Index Status → Copy Active Index File Path** 获取索引路径，在终端执行：

```bash
npm run benchmark:path -- "/path/to/index.nul" "driver" "src/lib" "dyc/dec" --runs 7
```

测试会预热一次、每条查询重复 7 轮，打印 `p50Ms`、`p95Ms`、Node.js CPU 使用时长、内存占用、结果数量和是否触及 150 条限制。输出不包含真实路径和查询文本（仅保留序号、模式及字符数），便于分享。脚本仅**只读**打开现有索引，不执行 `fd`，不修改当前索引、配置、日志或文件。`Node.js` 的 CPU/RSS 指标不包括 `fzf` 子进程，机器负载、Spotlight 与文件缓存会影响结果，最好保持相同索引、机器和查询，多轮测试再比较版本。

### 调试日志的时间与显示

`command-trace.jsonl` 和 `command-trace.previous.jsonl` 仍按 ISO 8601 的 UTC 时间存储，方便记录与跨时区排错；**View Diagnostics / View fd/fzf Trace** 在展示时按当前 macOS 系统时区（例如 UTC+08:00）转换，并把同一调用的开始与结束合并显示，包含状态、耗时、数量和退出码。原始日志无需迁移，关闭调试后不会继续追加。最多读取最近 50 个事件；没有后台日志刷新或新缓存文件。

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

已导入的本地扩展由用户自行维护，**不会通过 Raycast Store 自动更新**。如果更新并构建后命令没有反映新代码，可在相同仓库目录重新运行一次 `npm run dev`，验证扩展重新加载后按 `Ctrl+C` 结束热重载；不要通过卸载/重新安装作为常规更新手段。

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
| Raycast 中找不到 PathSeek | 在仓库根目录执行 `npm run dev` 自动导入，再在 Raycast 主搜索框搜索 `Build Index`；停止开发命令后扩展仍保留 |
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

PathSeek 的源代码遵循 [MIT License](LICENSE)。运行时依赖 Raycast API 和用户自行安装的 `fd` / `fzf`，并不打包或自动下载这两个命令行工具。


### 始终可用的路径拼音搜索

普通查询依旧只匹配文件/目录自身名称；仅使用 `/` 进入路径模式。连续父目录片段与最终名称均支持原文、英文、拼音首字母与全拼，例如 `fir/sec/thi/four-fi`、`dyc/dec/bg` 和 `第一次/dec/报告`。普通路径表达式交给原生 `fzf --scheme=path` 进行匹配排序，并保留逐层边界校验；带扩展运算符时继续保持兼容查询语义。所有结果来自实际索引，不推测文件路径。

冷启动基准不依赖已有索引、不清理用户数据：

```bash
npm run benchmark:cold -- 256
```

它在单独临时目录创建样本文件、运行 fd 并建立压缩索引，测量首次搜索后清理该临时目录。用于新旧版本在相同条件下对比，不代表用户真实家目录扫描耗时。
