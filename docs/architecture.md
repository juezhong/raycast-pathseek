# PathSeek 架构与模块说明

> 状态：开发版设计 + 初步代码实现。下述功能的「已提交」不等于在用户 Mac 上实测通过。

## 1. 项目目标与范围

PathSeek 是一款面向 macOS 的 Raycast Extension，目标对齐 Windows Listary 的核心工作流：

- 输入文件名或部分路径，直接搜索到文件和目录。
- 在 Raycast 结果列表中执行 Open、Show in Finder、Open Containing Folder、Copy Path。
- 未来在第三方应用唤起的 **Open/Save 文件选择对话框**中使用搜索结果导航原窗口，而非单独打开 Finder。
- 插件自行管理持久化索引、明确构建时机；不依赖 Raycast 内部搜索索引，也不在查询时重扫目录。

## 2. 当前架构

```text
                  +-------------------------------+
                  | Raycast UI                    |
                  | Search Files / Rebuild Index  |
                  | Index Status                  |
                  +-------------------------------+
                            |       |
          手动 Rebuild ----+       +---- Search Files
                     |                    |
                     v                    v
          +----------------+      +----------------+
          | index-store.ts |      | fuzzy-search.ts|
          | fd 扫描/发布索引 |      | fzf 模糊匹配    |
          +----------------+      +----------------+
                     |                    ^
                     v                    |
                  +-------------------------+
                  | environment.supportPath |
                  | index.json + *.nul      |
                  +-------------------------+
                                          |
                                          v
                                 +-----------------+
                                 | Raycast Actions |
                                 | Finder/Open/Copy|
                                 +-----------------+

          [P4 待开发] Dialog Bridge -> 原应用 Open/Save 窗口
```

## 3. 模块与代码导航

| 模块 | 位置 | 当前实现 |
| --- | --- | --- |
| 插件清单与设置 | [`package.json`](../package.json) | 命令注册、手动选择目录、Hidden、Symlinks、排除规则、fd/fzf 路径 |
| 索引管理器 | [`src/lib/index-store.ts`](../src/lib/index-store.ts) | `readIndex()`、`rebuildIndex()`、`findBinary()` |
| 搜索引擎 | [`src/lib/fuzzy-search.ts`](../src/lib/fuzzy-search.ts) | 对已发布索引执行 `fzf --filter`，限制结果条数 |
| 文件搜索界面 | [`src/search-files.tsx`](../src/search-files.tsx) | 查询、防抖、结果展示、Finder Actions |
| 重建命令 | [`src/rebuild-index.tsx`](../src/rebuild-index.tsx) | 显式启动 `fd` 索引构建 |
| 索引状态命令 | [`src/index-status.tsx`](../src/index-status.tsx) | 查看元数据、打开/复制支持目录 |
| Debug Info | [`src/debug-info.tsx`](../src/debug-info.tsx) | 收集系统版本与索引完整性报告（默认隐藏本地绝对路径） |
| Dialog Bridge | 尚未创建 | 原应用 Open/Save 对话框定位（P4） |

## 4. 控制流与数据流

**建索引：** 首次 Rebuild Index 打开目录选择器 → 用户明确提交 Build（或已有配置时点击 Rebuild Index Now）→ 取得写入锁 → `fd` 扫描选定文件夹 → 验证/封装自描述 v2 临时文件 → 一次原子 rename 替换 `index.nul`。打开 Search Files/Index Status 或仅更换目录绝不调用 fd；旧索引始终保留到新索引发布成功。

**搜索：** 用户执行 Search Files → 读取已有索引 → 统一调用 `fzf --extended --read0 --print0 --filter` 按文件名及路径匹配 → 最多展示 150 条 → Finder 原生图标 → 文件操作。支持 fzf 的模糊、精确、前后缀、排除、OR 语法，无独立 Regex 引擎。查询时不执行 `fd`。

**查看索引：** 用户执行 Index Status → `readIndex()` → 展示统计、时间、搜索目录，提供打开/复制 `environment.supportPath` 动作；这条路径不运行 `fd`。

**问题诊断：** 用户执行 Debug Info → 读取 Raycast 环境和 macOS 版本 → 检查当前元数据与数据文件是否存在 → 生成脱敏报告，不触发文件树扫描。

## 5. 错误与边界

- 目标索引不存在时，应提示先 Rebuild Index。
- 手动构建过程中若 `fd` 出错，必须拒绝发布不完整的索引，旧索引仍能正常使用。
- 部分目录权限可能受 macOS TCC（隐私权限）限制，需用户授权 Raycast；不要绕过系统权限。
- 多根目录重叠可能重复索引同一路径；后续要优化。
- 当前搜索在 query 变化时重新启动 `fzf`，有 CPU 与索引读取成本；先实测后优化。
- 文件对话框导航必须区分 Finder 本身与标准 NSOpenPanel/NSSavePanel，自定义面板应单独做兼容测试。
- **严格手动构建（当前决策）**：安装、启动、查询、读取状态、修改根目录都不触发 `fd`；仅用户明确执行构建或重建动作才运行。无 15 天刷新、无定时器、无后台扫描。
- **目前不实现**常驻 FSEvents、后台定时器、自动确认 Open/Save 或自动覆盖文件。

## 6. 开源与发布

- 项目使用 MIT License。
- 参考了 Raycast 上游 Fuzzy File Search 的产品结构与部分交互方式；详见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
- 当前开发图标暂借自 MIT 上游，Raycast Store 正式提交前必须替换为 PathSeek 自有图标。
- Raycast Store 上架前还需完成本地编译、权限、图标、锁文件、README 与质量检查。
- 技术方案和进度见 [规划目录](../plans/pathseek-development/task_plan.md)。

## 7. 延伸阅读

- [索引存储与维护](index-storage.md)
- [本地开发与调试](development.md)
- [Raycast Environment API](https://developers.raycast.com/api-reference/environment)
- [Raycast Storage API](https://developers.raycast.com/api-reference/storage)
- [Raycast Store 审核指南](https://developers.raycast.com/basics/prepare-an-extension-for-store)

## P4：只做文件选择与目录跳转，不实现自动窗口管理

- `src/dialog-search.tsx` 提供专用搜索入口，复用 `SearchFilesView`、同一份持久化索引与 fzf。
- 在用户于原 Open/Save 面板主动按下 ⌘⇧G 后，用 Raycast `Action.Paste` 默认粘贴搜索结果**完整绝对路径**；另有父目录备用操作。
- 文件路径可尝试在标准 Open 面板里定位/选中目标文件；目录路径可尝试进入该文件夹。实际应用行为需 Mac 端验收。
- **不做**活动窗口自动检测、Accessibility、Swift helper、AppleScript、额外 Finder、自动确认 Open/Save。不存在未来必须实现的 P4.2 自动导航阶段。
- 路径计算在 `src/lib/dialog-navigation.ts` 中完成，无额外 fd 搜索或目录遍历。

详见 [Open/Save 简明说明](open-save-dialog.md) 和 [Issue #7](https://github.com/juezhong/raycast-pathseek/issues/7)。
