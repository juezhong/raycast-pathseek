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
| 插件清单与设置 | [`package.json`](../package.json) | 命令注册、Search Roots、Hidden、Symlinks、排除规则、fd/fzf 路径 |
| 索引管理器 | [`src/lib/index-store.ts`](../src/lib/index-store.ts) | `readIndex()`、`rebuildIndex()`、`findBinary()` |
| 搜索引擎 | [`src/lib/fuzzy-search.ts`](../src/lib/fuzzy-search.ts) | 对已发布索引执行 `fzf --filter`，限制结果条数 |
| 文件搜索界面 | [`src/search-files.tsx`](../src/search-files.tsx) | 查询、防抖、结果展示、Finder Actions |
| 重建命令 | [`src/rebuild-index.tsx`](../src/rebuild-index.tsx) | 显式启动 `fd` 索引构建 |
| 索引状态命令 | [`src/index-status.tsx`](../src/index-status.tsx) | 查看元数据、打开/复制支持目录 |
| Debug Info | [`src/debug-info.tsx`](../src/debug-info.tsx) | 收集系统版本与索引完整性报告（默认隐藏本地绝对路径） |
| Dialog Bridge | 尚未创建 | 原应用 Open/Save 对话框定位（P4） |

## 4. 控制流与数据流

**建索引：** 用户执行 Rebuild Index 或索引满 15 天后进入 Search Files → 获取跨进程锁 → 校验配置 → `fd` 扫描 → 新 `.nul` 临时文件 → 新正式文件 → 原子切换 `index.json` → 重新读取验证新索引 → 清理旧 `.nul`。错误/中断时保留已发布的当前索引。

**搜索：** 用户执行 Search Files → 读取元数据和索引文件 → 模式选择（`fzf` 模糊或 JavaScript 正则流式扫描路径）→ 最多展示 150 条 → 显示 Finder 原生图标 → 打开或定位。查询时不执行 `fd`。

**查看索引：** 用户执行 Index Status → `readIndex()` → 展示统计、时间、搜索目录，提供打开/复制 `environment.supportPath` 动作；这条路径不运行 `fd`。

**问题诊断：** 用户执行 Debug Info → 读取 Raycast 环境和 macOS 版本 → 检查当前元数据与数据文件是否存在 → 生成脱敏报告，不触发文件树扫描。

## 5. 错误与边界

- 目标索引不存在时，应提示先 Rebuild Index。
- 手动构建过程中若 `fd` 出错，必须拒绝发布不完整的索引，旧索引仍能正常使用。
- 部分目录权限可能受 macOS TCC（隐私权限）限制，需用户授权 Raycast；不要绕过系统权限。
- 多根目录重叠可能重复索引同一路径；后续要优化。
- 当前搜索在 query 变化时重新启动 `fzf`，有 CPU 与索引读取成本；先实测后优化。
- 文件对话框导航必须区分 Finder 本身与标准 NSOpenPanel/NSSavePanel，自定义面板应单独做兼容测试。
- **15 天按需刷新（已实现初版）**：没有常驻监听和后台调度；过期索引只在下一次打开 Search Files 时尝试更新，失败重试间隔 24 小时。
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
