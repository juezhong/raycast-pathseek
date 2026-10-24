# Task Plan — PathSeek

- Plan ID: pathseek-development
- Repository: juezhong/raycast-pathseek
- Branch: main
- Plan Directory: plans/pathseek-development/
- Write Mode: manual_save
- Status: active / code-review-quality-gate
- Current Phase: Q1 — 首轮 Code Review 质量收口，暂停进入 P4
- Checkpoint ID: pathseek-20261024-review-02
- Last Checkpoint: pathseek-20261024-review-02 (2026-10-24T08:45:49.982Z; 三文件全部写入后已读回核验)
- Last Updated: 2026-10-24T08:45:49.982Z
- Storage: github_checkpointed

## Goal
开源 Raycast macOS 文件搜索工具 PathSeek，对齐 Windows Listary 的核心体验：插件自有持久化索引、文件名与完整路径快速搜索、Finder 文件操作、在原应用 Open/Save 文件对话框中导航。最终目标是 Raycast Store 发布。

## 需求与技术边界（当前版本）
- **索引**：由 `fd` 构建，存入 Raycast `environment.supportPath`；默认不在每次搜索字符输入时重扫。首次显式 Rebuild，15 天后下一次进入 Search Files 按需刷新，允许手动重建。不得假称有常驻后台守护/保证按时刷新。
- **搜索**：`fzf` 模糊匹配、JavaScript Regex 完整路径匹配；Regex 性能安全需要整改。File/Directory 筛选仍是待开发项。
- **结果**：Finder 原生文件图标，Open/Show in Finder/Open With/Copy Path/Quick Look；需要完善失效路径处理。
- **索引正确性**：构建失败保留有效索引；新索引完整后原子提交；正式索引路径不会被并发清理误删；metadata/data 一致性与崩溃恢复是审查阻塞项。
- **Dialog Bridge**：未来通过 macOS API/Accessibility 返回原应用 Open/Save 面板，不额外弹出 Finder；不得自动确认 Save/Open。
- **开源发布**：MIT、保留 Fuzzy File Search 第三方声明。中文/英文 README 保持同步，审查/文档与计划受 GitHub 管理。
- **数据隐私**：本机索引可能含私有绝对路径，禁止提交到公开仓库/Issue。

## 项目状态
| 里程碑 | 当前状态 | 验收依据 |
| --- | --- | --- |
| P0：GitHub/计划/许可证 | **已完成** | 三文件初始检查点与仓库已存在 |
| P1：Fuzzy File Search 审查与 Raycast 工程 | **基本实现，部分验证** | 用户 Issue #1 已勾选安装、命令、部分索引测试；未有完整 lint/build 证据 |
| P2：持久化索引与15天更新 | **已实现，需整改** | main 存在 UUID 删除读竞态；Draft PR #3 固定路径方向正确，但 CR-01 metadata 一致性尚未修复 |
| P3：fzf / Regex / Finder Actions | **已实现，待测试与安全整改** | Issue #2 尚未勾选，Regex 可用性风险 CR-05 |
| Q1：初轮 Code Review 质量收口 | **审查完成，整改待开始** | [审查报告](../../docs/reviews/2026-10-24-initial-code-review.md) · [Issue #4](https://github.com/juezhong/raycast-pathseek/issues/4) |
| P4：原 Open/Save 对话框跳转 | **未开始** | 等待 Q1 的 P0/P1 风险处理 |
| P5：测试/文档/Store 发布 | **未开始** | 完整 CI 与macOS兼容性、商店提交 |

## 当前优先级

1. **P0 — CR-01 / Draft PR #3**：重新设计数据/元数据提交与失败恢复，覆盖 metadata rename 故障注入。
2. **P1 — CR-06**：CI 添加 `npm ci`、`npm run lint`、`npm run build`、端到端索引测试和锁文件；PR3 基础测试已通过但远非完整验证。
3. **P1 — CR-02**：修复 main UUID 清理的读者竞态，PR3 固定索引路径通过 review 和 Mac 实测后再合并。
4. **P1 — CR-03/CR-04**：规范 15 天按需刷新、UI 退出时的行为和重试退避。
5. **P1 — CR-05**：把 Regex 匹配隔离或约束到可取消执行流程，避免主线程灾难性回溯。
6. **P2 — CR-07/CR-08/CR-09**：临时文件清理、路径状态、文件/目录筛选、文档与用户反馈完善。
7. **P4**：上述关键质量门槛通过后再开发原应用 Open/Save Dialog Bridge。

## 验收条件
- [ ] PR #3 固定索引 `index.nul` 的发布、失败注入、恢复及读写竞态测试通过。
- [ ] 至少一次完整 Raycast `npm ci` / lint / build / test 的 CI 通过；提交 lockfile。
- [ ] Issue #1 / #2 的实际 macOS 测试完成，修复问题与功能验收分开记录。
- [ ] 索引不会因同时/中断重建而丢失；新索引与元数据一致性可恢复。
- [ ] 15 天按需刷新按已承诺的时机工作，不在输入搜索词时反复运行 fd。
- [ ] Regex 不会造成 Raycast 无响应，并有测试证明极端情况可控。
- [ ] P4 原文件选择窗口原位导航完成并经受支持的应用实机验证。
- [ ] 发布前完成自有图标、MIT 归属、README 中英同步与 Raycast Store 规范检查。

## Working Agreement / Checkpoints
- 本轮明确授权的是**执行 Code Review 并更新现有计划文件一次**，所以保持 `manual_save`；**不把技能说成自动后台保存**。
- `planning-with-files-chatgpt` 实际支持 `continuous_checkpoints`：需用户对本仓库、本目录下三份 Markdown 文件明确持续授权。获得授权后每个阶段完成、重要 PR、质量发现、可复现错误后主动更新三文件，不需要每次重新询问。
- 每次检查点：先确认最新 Blob SHA，按 `findings.md → progress.md → task_plan.md` 更新相同 `checkpoint_id`，随后三文件回读一致。单个文件提交不是三文件原子事务。
- GitHub Issues 保留可勾选清单，用户实际测试结果为准；提交代码不代表通过验收；PR 合并仍单独审查。

## Open Questions
- CR-01 最终采用索引单文件自描述元数据，还是双文件恢复协议？
- 15 天更新是否改为显式 Action（而非 UI Effect）才能符合 Raycast 生命周期？
- Regex 改由 rg/safe-regex/子进程哪种实现最兼顾依赖、性能、Store 审核？
- 自定义文件窗口与标准 NSOpenPanel/NSSavePanel 的可支持范围待 P4 实测。

## Next Step
在 Draft PR #3（fix/stable-index-file-atomic-swap）中修复 CR-01：为 index.nul 与 index.json 的分步发布设计可恢复提交协议，添加“数据发布成功而元数据发布失败”的故障注入测试；完善 npm run build/lint 的 CI 门槛，验证后再决定是否合并 PR。
