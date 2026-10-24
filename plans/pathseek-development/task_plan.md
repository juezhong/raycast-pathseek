# Task Plan — PathSeek

- Plan ID: pathseek-development
- Repository: juezhong/raycast-pathseek
- Branch: main
- Plan Directory: plans/pathseek-development/
- Write Mode: manual_save
- Status: planned
- Current Phase: P1 (pending)
- Checkpoint ID: pathseek-20261024-01
- Last Checkpoint: pathseek-20261024-01, 2026-10-24, subject to readback verification
- Last Updated: 2026-10-24
- Storage: github_checkpointed after successful readback

## Goal
开发并开源 PathSeek：基于 Raycast 的 macOS Listary 式文件搜索工具。使用 fd 手动生成插件自主管理的持久化文件索引，使用 fzf 模糊搜索；具备 Finder 操作和原应用 Open/Save 文件对话框导航能力，最终计划提交 Raycast Store。

## Scope and Constraints
- 使用 TypeScript、React、Raycast API；优先审查/选择性复用 Fuzzy File Search 项目。
- fd 只在首次用户明确构建及手动重建时扫描；搜索期间绝不重新运行 fd 全盘遍历。
- 默认不定时刷新、不自动 FSEvents 监听；索引过期是预期可见行为。
- 支持多根目录、隐藏文件、排除规则、文件/目录筛选和路径模糊匹配。
- 索引仅存本机 Raycast 数据目录，临时写入并校验后原子替换；异常保留旧索引。
- 支持 Open、Show in Finder、Open Containing Folder、Copy Path；执行前校验路径。
- Dialog Bridge 必须在原应用 Open/Save 窗口导航，不是额外打开 Finder；默认不自动提交 Open/Save。
- 遵守 upstream MIT 归属、保留原版权；不把本地索引、隐私和凭证写入 GitHub。
- 本次授权仅在 plans/pathseek-development/ 创建三个计划文件；源码、Issues、PR 需单独按后续指令处理。

## Architecture
1. Index Builder：fd -> 临时文件 -> 校验 -> 原子替换。
2. Index Manager：索引元数据/根目录/时间/数量/错误处理。
3. Search Engine：fzf 查询已有索引、结果限流、文件/目录过滤。
4. Raycast UI：Search Files、Rebuild Index、Index Status、Finder Actions。
5. Dialog Bridge：保存来源应用和面板上下文，恢复焦点，导航路径并安全处理异常。

## Phases
| 阶段 | 开发任务 | 状态 | 验收 |
| --- | --- | --- | --- |
| P0 | 仓库绑定与三个计划文件 | complete after verification | GitHub 三文件检查点一致 |
| P1 | 审查 Fuzzy File Search，初始化 Raycast 工程及 MIT 第三方声明 | pending | npm ci / npm run dev 能启动 |
| P2 | 持久化 Index Manager 与手动 Rebuild | pending | 重启后复用，普通搜索不运行 fd，失败保留旧索引 |
| P3 | fzf 路径搜索、文件操作、性能验证 | pending | 结果正确；Open/Show/Copy 正常 |
| P4 | Open/Save 对话框集成 | pending | 原窗口导航成功，不自动确认或覆盖 |
| P5 | 测试、CI、文档及 Raycast Store 提交 | pending | 构建测试通过、提交审核 PR |

## Acceptance
- [ ] 手动建索引、搜索、重启后直接搜索均正常。
- [ ] 除手动重建外不会执行 fd 文件系统扫描。
- [ ] 索引失败保持旧版本可用；路径编码和权限错误可处理。
- [ ] Finder 文件动作完整。
- [ ] 标准 Open/Save 对话框中的原位导航已实测。
- [ ] 大型目录的 CPU/I/O/响应表现可接受。
- [ ] CI、README、许可证与发布材料完成。

## Risks
- Raycast SDK 与上游源码需复核，不能假定内置搜索索引可以调用。
- 文件对话框兼容依赖 macOS 的窗口焦点/Accessibility 行为，需要用户本机实测。
- Store 上架必须遵守届时审查规则，成功提交不代表审核通过。

## Next Step
审查 raycast/extensions 仓库 extensions/fuzzy-file-search 当前源码与 MIT 许可，形成复用与重构清单；在获得额外代码写入授权前不修改源码。
