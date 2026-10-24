# PathSeek 首轮 Code Review（2026-10-24）

> 范围：`main` 当前插件源码、`fix/stable-index-file-atomic-swap`（Draft [PR #3](https://github.com/juezhong/raycast-pathseek/pull/3)）、Issue #1/#2、构建与测试配置。本文是**静态源码审查 + GitHub CI 状态核查**，不是 macOS 完整实机验证。
>
> **结论：需要修改后再合并 PR #3；修复 P0/P1 后再启动 P4 Dialog Bridge。** 下述“存在风险”区别于“已经实机复现”，不能混为一谈。

## 审查范围与已有进展

- `main` 已有 Raycast 命令：Search Files、Rebuild Index、Index Status、Debug Info；支持持久化 fd 索引、fzf 和 Regex 查询、原生文件图标、Finder Actions。
- [Issue #1](https://github.com/juezhong/raycast-pathseek/issues/1)：用户已实测安装与部分索引功能，并评论早期 ENOENT 已修复；仍有未勾选项。
- [Issue #2](https://github.com/juezhong/raycast-pathseek/issues/2)：15 天更新、Regex、图标共 17 项尚待实测。
- Draft [PR #3](https://github.com/juezhong/raycast-pathseek/pull/3)：将 UUID 索引切换为稳定文件名 `index.nul`，附带 Node 测试和 GitHub Actions。
- PR #3 当前对应的 `Index lifecycle tests` workflow 状态为 **completed / success**（GitHub 工作流回执）；但**未验证**完整 `npm run build`、`npm run lint` 与真实文件选择对话框操作。
- 中文/英文 README、架构、索引存储文档已存在；初始 Planning with Files 三文件一直停留在 `pathseek-20261024-01`，进度未同步。

## 审查发现（按优先级）

### CR-01 [P0 / PR #3 合并阻塞] 数据文件和元数据分两次发布，失败后可能不一致

- **位置**：[PR #3 的 index-store.ts](https://github.com/juezhong/raycast-pathseek/blob/fix/stable-index-file-atomic-swap/src/lib/index-store.ts#L220-L256)，约第 230–243 行；[`index-files.ts`](https://github.com/juezhong/raycast-pathseek/blob/fix/stable-index-file-atomic-swap/src/lib/index-files.ts#L12-L18)。
- **代码路径**：`publishIndex(temp, indexDirectory)` 原子替换固定 `index.nul`，随后独立 `rename(metadataTemp, metadataPath)`。
- **问题**：第二步失败/进程被终止后，`index.nul` 已变新但 `index.json` 仍是旧的 `count/createdAt/roots`。文件路径不会消失，但索引状态与 15 天触发逻辑可能错误；测试目前只涵盖**写入前失败**。
- **建议**：明确两个文件的提交/恢复协议。例如索引数据内嵌 metadata（单个原子文件），或写 journal / commit marker 并在下次启动校验、修复。至少增加“成功发布数据、元数据提交失败”的注入测试和重启恢复测试。
- **性质**：源代码可确定的事务一致性缺口；极端失败路径尚未实测。

### CR-02 [P1] 原 main 的旧 UUID 清理存在读取竞态；PR #3 的方向正确

- **位置**：[main 的 index-store.ts](https://github.com/juezhong/raycast-pathseek/blob/main/src/lib/index-store.ts#L180-L191) 与 [Search Files](https://github.com/juezhong/raycast-pathseek/blob/main/src/search-files.tsx)。
- **场景**：搜索读取旧 `index.json` 后，重建将 metadata 切到新 UUID 并清理旧文件，搜索随后才打开旧路径 → 可能 `ENOENT`。只锁住多个写入者不能避免读写竞态。
- **建议**：采用 PR #3 的稳定文件名 + 同目录原子替换；旧 UUID 迁移清理需保护存量读者。**保留 PR 为 Draft，先处理 CR-01。**
- **性质**：可从代码推出的竞态；不能推定 Issue #1 的历史 ENOENT 唯一由此触发。

### CR-03 [P1] 15 天自动刷新依赖 Raycast UI 生命周期，不保证构建完成

- **位置**：[search-files.tsx](https://github.com/juezhong/raycast-pathseek/blob/main/src/search-files.tsx#L36-L63)。
- **场景**：React Effect 在打开 Search Files 后启动 `fd`，用户很快关闭 Raycast、窗口卸载或扩展宿主终止时，构建可能中断；索引旧版继续保留，但遗留临时文件/锁和重复尝试策略需要处理。
- **建议**：把“过期状态检测”和“执行重建”区分。可采用显式/可取消的更新动作或宿主支持的后台任务（需验证 Raycast 官方能力），不宣称能在关闭 UI 后继续完成。为中断/重启加入集成测试。
- **性质**：生命周期风险，尚待 macOS GUI 复现。

### CR-04 [P1] 自动重建的 24 小时重试标记写入时机过早

- **位置**：[index-store.ts](https://github.com/juezhong/raycast-pathseek/blob/main/src/lib/index-store.ts#L158-L176)。
- **场景**：获取重建锁、校验根目录/执行 fd 之前，先写入 `auto-refresh.json.lastAttempt`。如果另一进程正在重建导致锁失败，或者进程退出，后续可能 24 小时都不再自动尝试。
- **建议**：将“上次尝试”和“失败重试退避”建模为独立状态，区分锁忙、退出、扫描失败和成功。只有确实开始扫描/收到失败结果后才更新节流信息，成功时清除失败节流。
- **性质**：从代码可确定的逻辑缺陷（表现还需实测）。

### CR-05 [P1] 正则匹配在 Raycast JavaScript 主线程执行，可被病态正则拖慢

- **位置**：[regex-search.ts](https://github.com/juezhong/raycast-pathseek/blob/main/src/lib/regex-search.ts#L16-L40)。
- **场景**：`new RegExp(query, "iu")` 对路径逐一 `regex.test`。限制正则长度 256 **不能防止灾难性回溯**；某些正则与长路径组合会使事件循环阻塞，AbortSignal 无法中断同步的单次 `regex.test()`。
- **建议**：优先采用独立的可取消进程执行正则匹配（例如受控 `rg` / 安全线性时间匹配引擎），或针对危险正则增加限制并对查询执行超时隔离；加错误输入和极端表达式压力测试。
- **性质**：语言层面已知行为；当前路径下存在潜在可用性风险。

### CR-06 [P1] CI 只覆盖索引文件辅助函数，不能作为插件整体质量门槛

- **位置**：[PR #3 workflow](https://github.com/juezhong/raycast-pathseek/blob/fix/stable-index-file-atomic-swap/.github/workflows/index-lifecycle.yml)，[tests](https://github.com/juezhong/raycast-pathseek/blob/fix/stable-index-file-atomic-swap/tests/index-files.test.mjs)。
- **现状**：`npm test` 在 macOS Actions 上通过，但只覆盖固定路径发布、旧文件句柄和历史 UUID 清理。没有端到端执行 `rebuildIndex()`、`fd` 失败、搜索读写交错、自动刷新，且 workflow 没有 `npm run build` 或 `npm run lint`。
- **建议**：把 `npm ci`、lint、build、测试加入 PR CI；提交并审核 `package-lock.json`；增加临时目录中的真实 `fd` 小规模构建测试与失败注入测试。
- **性质**：已确认的测试覆盖缺口。**不能说目前完整构建已通过**。

### CR-07 [P2] 重建文件与工具状态的异常退出清理不足

- **位置**：[index-store.ts](https://github.com/juezhong/raycast-pathseek/blob/main/src/lib/index-store.ts) `rebuildIndex()/runFd()`。
- **问题**：进程崩溃/强制终止时，`.tmp` 可能留在本机；发布文件格式只使用 `stat.isFile()`，没有校验 NUL 项数、末尾分隔符或扫描文件大小。旧 UUID 迁移缓冲期与实际清理时机也依赖下一轮 Rebuild。
- **建议**：启动时仅针对明确匹配且超时的本扩展临时文件进行安全清理；完成扫描时校验条目数和格式；诊断工具显示过期临时文件数量。

### CR-08 [P2] UI 与旧索引的功能一致性需要收口

- **位置**：[search-files.tsx](https://github.com/juezhong/raycast-pathseek/blob/main/src/search-files.tsx#L126-L150)、索引元数据结构。
- **问题**：文件/目录筛选在需求和计划中存在，但当前 UI 没有类型过滤；索引仅存路径，删除后仍在 15 天窗口内的结果可能无法打开；文件类型图标依赖真实路径存在，不是确定的索引类型字段。
- **建议**：确认首版是否需要按文件/目录过滤，并决定是构建时记录类型还是查询时检查。执行 Open/Show 等动作前校验路径是否存在并提供清晰提示。

### CR-09 [P2] 版本与流程文档未及时同步

- **位置**：[`plans/pathseek-development`](https://github.com/juezhong/raycast-pathseek/tree/main/plans/pathseek-development)、README、索引文档。
- **问题**：三个计划文件长期记录 P1 pending、默认不自动刷新、待审查 Fuzzy File Search，已经与代码及用户最新决策冲突。
- **建议**：本轮恢复一致性检查点；重要 PR、阶段状态变化、新需求、已证实的 Bug 修复和测试结果必须更新计划、发现和进度。不要把“实现已提交”等同“测试已通过”。

## 正面评价

- 没有重用 Raycast 私有索引；fd 与 fzf 分工明确，持久化目录使用 `environment.supportPath`。
- `fd --print0`、`fzf --read0/--print0` 和 Regex 的 NUL 解析思路能够处理路径中包含换行的情况。
- 索引数据不进入 GitHub；Debug Info 默认只公开汇总数据而不是完整目录路径。
- 文件原子重命名、跨进程互斥、独立单元测试的方向正确；PR #3 的 CI 已经成功执行。
- 中文/英文 README、索引存储、开发说明与独立中文 Issues 已形成可协作的文档体系。

## 合并策略和后续优先级

**PR #3 暂不合并。** 先处理 CR-01/CR-06，补齐构建校验和必要测试；随后处理自动更新生命周期 CR-03/CR-04、正则搜索 CR-05。CR-07/08 可并行安排但不应阻挡安全修复。

### 下一轮最小可验证任务
1. 在 PR #3 分支修复或明确保证索引数据与 `index.json` 的崩溃恢复一致性（CR-01）；加入“数据已发布但 metadata 发布失败”的测试。
2. CI 增加 lint、build、端到端索引写入及读写竞态测试（CR-06），并确认 macOS GitHub Actions 结果。
3. 用户在 Mac 上验证固定索引路径重建、边搜索边重建和旧索引升级行为，再将 Draft PR 转为 Ready。

## 审查证据性质

- ✅ GitHub 源码和 Issue/PR 状态：已读取。
- ✅ PR #3 工作流 `Index lifecycle tests`：已确认 `completed / success`。
- ⚠️ 静态分析发现的失败模式：多数尚未通过故障注入或 macOS GUI 验证。
- ❌ 未执行/未确认：完整 `npm run lint`、`npm run build`、真实 macOS Open/Save/Dialog Bridge 测试。
