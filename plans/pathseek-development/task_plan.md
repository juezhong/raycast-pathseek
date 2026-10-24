# Task Plan — PathSeek

- Plan ID: pathseek-development
- Repository: juezhong/raycast-pathseek
- Branch: main
- Plan Directory: plans/pathseek-development/
- Write Mode: continuous_checkpoints
- Status: active / code-review-quality-gate
- Current Phase: Q1 — GUI accepted, remaining technical Code Review
- Checkpoint ID: pathseek-20261024-issue6-acceptance-09
- Last Checkpoint: pathseek-20261024-issue6-acceptance-09 (2026-10-24; 3-file verification)
- Last Updated: 2026-10-24
- Storage: github_checkpointed

## Goal
开源 Raycast macOS 文件搜索工具 PathSeek，对齐 Windows Listary 的核心体验：插件自有持久化索引、文件名与完整路径快速搜索、Finder 文件操作、在原应用 Open/Save 文件对话框中导航。最终目标是 Raycast Store 发布。

## 需求与技术边界（当前版本）
- **索引**：由 `fd` 构建，存入 Raycast `environment.supportPath`；默认不在每次搜索字符输入时重扫。首次在 Rebuild Index 显式选择目录并点击 Build；之后只有用户主动 Rebuild 才调用 fd，**永不按时间自动刷新**。不得在安装、启动、搜索、查看状态或修改目录时自动索引。
- **搜索**：统一由 `fzf` 的扩展搜索匹配路径（模糊、精确、前后缀、排除、OR），不再提供 JavaScript Regex 引擎。File/Directory 筛选仍待开发。
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
| P2：持久化索引、纯手动建索引与目录引导 | **Draft PR #3 已实现，待 Mac UI 验收** | v2 单文件原子发布、首次选目录及 ⌘K 修改目录，CI 成功 |
| P3：fzf-only / Finder Actions | **已提交至 Draft PR #3，待新版 Mac 验收** | Issue #2 已有部分旧版勾选；Regex 已取消，改为 fzf 内建扩展搜索 |
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


## 检查点更新 — 2026-10-24（pathseek-20261024-pr3-v2-03）

- **P0 CR-01：PR #3 自描述索引 v2 初步实现已提交；仍未验收完成**。单文件索引消除了原本 index.nul / index.json 两次提交不一致，已通过 7/7 helper 测试与 TypeScript 检查；需 CI lint/build 和 macOS GUI 测试。
- **P1 CR-06：质量门槛已补充 CI**（npm install/test/tsc/lint/build），但 lint 目前失败，build 尚未执行，不能合并。
- **已知阻塞**：manifest 作者 `juezhong` 未能通过 Raycast 用户名查验；另外多个源码需要 Prettier 格式化。用户需确认 Raycast 账户用户名。
- **未改变的后续任务**：15 天刷新生命周期和重试标记 CR-03/04、Regex 阻塞风险 CR-05、临时文件/目录筛选 CR-07/08，以及 P4 Open/Save Dialog Bridge。
- **分支状态**：[PR #3](https://github.com/juezhong/raycast-pathseek/pull/3) 仍为 Draft；此时不能简单告知用户 `git pull main` 即可测试新格式。
- **验证依据**：[PR3 实施说明](https://github.com/juezhong/raycast-pathseek/pull/3#issuecomment-6382347272)；macOS GitHub Actions；[Code Review Issue #4](https://github.com/juezhong/raycast-pathseek/issues/4)。
- **下次保存规则**：完成 lint/build、Mac 实机验收、PR 合并或其他阶段转变后，仍应对三个文件做一致性检查点；但仓库当前 `Write Mode: manual_save`，没有持续后台自动写入授权。

## Next Step
确认正确的 Raycast 账户用户名（当前 package.json author=juezhong 被官方校验返回 404），据此修正 PR #3 的 manifest；随后修复 Prettier 格式并重新运行 macOS CI 的 lint/build。

## 2026-10-24 阶段确认：开发 CI 通过，发布 lint 延后

- [x] PR #3：`npm test` 7/7、`tsc --noEmit`、`npm run lint:code`、`npm run build` 在 macOS GitHub Actions **全部通过**。
- [ ] `format:check` 与 Raycast Store `npm run lint`：**未通过**；Prettier 应在近期修正，真实 Raycast author 用户名在**发布前**补齐，不影响继续开发。
- [ ] PR #3：macOS 实机 v1→v2 索引迁移/重建中搜索/手动中断测试，审查后再合并。
- [ ] 后续 CR-03/04/05：15 天按需刷新的生命周期、重试退避，以及 Regex 性能安全。
- 重要区别：**开发期 CI 成功 ≠ Raycast Store 上架检查通过**。保留发布门槛，不借用他人用户名或隐藏失败日志。
- 关联：https://github.com/juezhong/raycast-pathseek/pull/3#issuecomment-6382410366

## 2026-10-24 开发者追踪检查点（pathseek-20261024-debug-trace-05）

- [x] 已实现默认关闭的 fd/fzf 开发者追踪（只在 opt-in 时写本地脱敏 JSONL），提供调用原因、参数结构、start/end、结果数量及耗时。
- [x] 已在 Debug Info 添加追踪视图和刷新/复制功能。
- [x] 已提交 [追踪文档](https://github.com/juezhong/raycast-pathseek/blob/fix/stable-index-file-atomic-swap/docs/developer-tracing.md) 与 [Issue #5](https://github.com/juezhong/raycast-pathseek/issues/5) 中文验收清单。
- [x] 最新 Draft PR #3 macOS CI 通过代码测试、TypeScript、源码 ESLint 和 Raycast build。
- [ ] 用户从 PR #3 独立工作目录验证：默认关闭不增加写盘、Fuzzy fzf 追踪、Rebuild fd 追踪、Regex 无 fzf、v1→v2 兼容及索引重建时查询。
- [ ] 仍待完善 Code Review 的 CR-03/04/05（过期更新生命周期、失败重试状态、正则性能安全），并完成 macOS 功能验收。
- [ ] PR #3 仍为 Draft，不能仅因为开发期 CI 成功就合并。Raycast Store 用户名与完整 lint 在**发布前**处理。
- 本次在用户开发请求执行期间按 Planning with Files 的 `continuous_checkpoints` 模式保存三个指定计划文件；不表示存在后台自动执行。

## Current Next Step (checkpoint pathseek-20261024-debug-trace-05)
在 Mac 上从 Draft PR #3 独立工作目录加载扩展，验证 v1→v2 索引迁移、搜索与重建并发，以及开发者 fd/fzf 追踪的默认关闭/开启行为；到 Issue #5 和 PR #3 提交实测结果，再决定 Ready for Review / 合并。

## 2026-10-24 当前生效决策：搜索仅使用 fzf（pathseek-20261024-fzf-only-06）

- [x] 用户确认不需要单独正则搜索，保持 **Search Files 单一搜索框 + fzf 引擎**；不引入 JavaScript 正则匹配器。
- [x] Draft PR #3 删除 `regex-search.ts` 与模式切换，fzf 显式启用 `--extended`；支持模糊、精确、后缀、排除、OR；移除旧 CR-05 Regex 风险项。
- [x] 最新 PR #3 macOS GitHub Actions 开发期质量门槛返回 success（索引单元测试、类型检查、源码 ESLint、Raycast build）。
- [x] 中英文 README 和技术说明、Issue #2 / #4 / #5 已同步范围变化。
- [ ] 用户在 Mac 对**新 fzf-only PR3 版本**进行回归：同一搜索框、fzf 语法、查询不启动 fd、文件/目录图标、索引迁移与 fd/fzf Debug 记录。
- [ ] 保留 15 天刷新 CR-03/04、临时文件/存在性 CR-07/08 等剩余质量问题，再决定 Draft PR #3 是否 Ready / 合并。
- [ ] 正式 Raycast Store 用户名和全量 `ray lint` 上架校验仍按用户要求在发布前再处理。
- 当前 repo main 尚未包含 fzf-only 改动；用户测试需要 PR #3 独立工作目录。

## Latest Next Step (pathseek-20261024-fzf-only-06)
请维护者继续在 Mac 上用 Draft PR #3 独立 worktree 验收单一 fzf 搜索（含 .pdf$、'report、!node_modules、OR）、fd/fzf 调用追踪和索引重建；根据 Issue #2 / #5 实测与剩余 Code Review 风险决定 PR #3 是否 Ready / 合并。

## 2026-10-24 — 用户 Mac 验收与 fzf 结果截断修复（pathseek-20261024-mac-log-limit-07）

- [x] 用户已在 macOS 15.1.1、Raycast 1.104.32 下验证 PR #3 基本功能；v2 index.nul 单文件索引正常，7975 条路径、716460 B、当前索引代数 1。
- [x] fzf 搜索通常约 15–19 ms；当前追踪样本无额外 fd 调用，含预期 cancelled 记录。
- [x] 发现 max=150 仍输出 151–159 的代码边界；已在 PR #3 新增有严格上限的 fzf NUL 累积器、`limit-reached` 状态与 4 个回归测试。
- [x] GitHub Actions 对上述修复的开发期测试、tsc、源码 ESLint、Raycast build 均已完成成功。
- [x] 更新 [Issue #2](https://github.com/juezhong/raycast-pathseek/issues/2)（10/20）、[Issue #5](https://github.com/juezhong/raycast-pathseek/issues/5)（8/14）的已验证项；未测试的极端场景保持未勾选。
- [ ] 用户在 Mac 上复测本次 150 条上限改动，确保 `limit-reached, results=150` 且无 151–159。
- [ ] 后续 Code Review 聚焦 CR-03/04（15 天刷新生命周期/重试退避）和剩余关键稳定性验证；PR #3 仍 Draft，未获合并授权。
- [ ] Raycast Store 作者身份及全量发布校验按用户要求延后到正式发布前。

## Active Next Step (pathseek-20261024-mac-log-limit-07)
用户在 Mac 上更新 PR #3 独立 worktree，搜索一个能匹配超过 150 条路径的词，检查 Debug Info 最新记录为 limit-reached / results=150（不再有 151–159）；通过后对 Draft PR #3 进行最终 Code Review 与剩余 P1 风险评估，再征得用户明确同意后考虑合并 main。

## 2026-10-24 当前生效的产品决策（pathseek-20261024-manual-setup-08）

- [x] fzf 150 条上限用户实测通过；不再要求重复该项。
- [x] 用户决定只允许**手动建立/重建索引**；已在 Draft PR #3 删除 15 天自动刷新与任何 Search Files 启动重建。
- [x] 首次使用 Rebuild Index 必须先明确选择一个/多个目录（不默认索引 Home）；只有明确提交 Build 才调用 fd。
- [x] 后续 Rebuild Index ⌘K 提供 Change Indexed Folders、Rebuild Index Now；只保存新目录不会自动刷新已发布索引。
- [x] Search Files / Index Status 缺索引状态显示引导动作；中英文 README 与技术文档已更新。
- [x] 创建 [Issue #6](https://github.com/juezhong/raycast-pathseek/issues/6) 面向普通用户的简单测试清单，旧技术 Issue 交由助理/CI 管理。
- [x] 最新 macOS GitHub Actions 测试、tsc、源码 ESLint、Raycast build 全部通过；静态测试新增 manual-only 防回归约束。
- [ ] 用户在 Mac 对**本次新代码**测试首次无索引、目录选择、Cmd+K 修改根目录、无自动 fd；可以直接在聊天中口头反馈，由助理判断测试状态。
- [ ] 复核原子索引崩溃保护/失效文件路径等剩余 Code Review 风险；再决定 PR #3 是否 Ready。合并 main 需要用户确认。
- [ ] 正式 Raycast Store 作者账户与发布校验仍等到发布前处理。

## Active Next Step (pathseek-20261024-manual-setup-08)
用户在 Mac 更新 Draft PR #3 后，简短验证首次无索引提示、目录选择、打开 Rebuild 时不自动执行 fd、⌘K 更改目录及显式 Rebuild；由助理根据聊天反馈维护简单 Issue #6。之后集中代码审查剩余索引稳定性问题，用户授权后再讨论合并 PR #3。

## 2026-10-24 — Issue #6 实机验收已全部完成（pathseek-20261024-issue6-acceptance-09）

- [x] 用户已在 macOS/Raycast 完成 [Issue #6](https://github.com/juezhong/raycast-pathseek/issues/6) 所有 **11/11** 用户可见操作：空状态引导、首次选目录、手动 Build/Rebuild、⌘K 更换目录、不会自动 fd、搜索/图标/追踪。
- [x] PR #3 的最新 macOS GitHub Actions 已确认 completed/success：npm test、TypeScript、源码 ESLint、Raycast build；不能将 Store lint 的非阻塞校验解释为正式上架通过。
- [x] 已更新 Issue #4 的 Code Review 验收范围：自描述 v2 原子发布设计及现有测试完成、取消旧自动刷新待办；不再把复杂故障注入和锁测试交给用户。
- [ ] **剩余合并前开发者工作**：真实 fd 的集成与异常中断/多写者风险评估、npm lockfile / 可复现构建、迁移后的索引完整性、文档一致性。针对可复现的问题修正并跑 CI。
- [ ] 在质量复审完成后再将 Draft PR #3 变为 Ready；**合并需要维护者明确同意**，当前保持 main 不变。
- [ ] P4 原应用 Open/Save Dialog Bridge 尚未开始；Raycast Store 作者身份/正式发布检查仍留到上架前。

## Active Next Step (pathseek-20261024-issue6-acceptance-09)
Issue #6 的 11/11 项用户可见 Mac 验收已完成，PR #3 最新 macOS CI 通过。下一步由助理完成技术 Code Review 剩余阻塞：重点核验 UUID→v2 升级及中断/并发安全、真实 fd 集成场景、可复现的 npm lockfile 与文档一致性；无需用户再做复杂测试。PR #3 仍 Draft，未经明确同意不合并 main。
