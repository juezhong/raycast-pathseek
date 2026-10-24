# PathSeek PR #3：合并前技术复审（2026-10-24）

> 这是对原 [首轮 Code Review](https://github.com/juezhong/raycast-pathseek/blob/main/docs/reviews/2026-10-24-initial-code-review.md) 的更新，不覆写历史审查结论。本文对照当前 **fix/stable-index-file-atomic-swap** 开发分支，避免把旧版 15 天自动刷新或 JavaScript Regex 误当成当前功能。

## 当前产品范围与实际验收

- 安装、打开 Search Files/Index Status/Rebuild Index、修改扫描目录均不执行 fd。只有明确点击首次 **Choose Folders and Build Index** 或后续 **Rebuild Index Now** 才运行 fd；没有自动刷新、后台定时任务。
- 用户在 macOS/Raycast 中已完成 [Issue #6 的 11/11 项](https://github.com/juezhong/raycast-pathseek/issues/6)（首次选目录、⌘K 改目录、手动重建、fzf/Finder 图标和调用追踪）。
- 查询仅使用 fzf 的扩展语法，不存在独立 Regex 引擎。搜索上限 150 条；用户报告最新修复符合上限。
- 开发者调用追踪默认关闭，日志脱敏，诊断时可查看 fd/fzf 的启动原因、耗时、数量和退出状态。
- **尚未合并 main**：这里的 CI 只验证 Draft PR #3 代码；与已发布的 Raycast Store 无关。

## 问题收口（对照原 CR）

| 项目 | 状态 | 依据 |
| --- | --- | --- |
| CR-01：数据/元信息双提交 | **已解决** | v2 自描述 index.nul，单次 atomic rename 发布；单元测试覆盖失败前保留已有索引 |
| CR-02：UUID 路径旧索引失效 | **已解决主要竞态** | 稳定 index.nul，读者通过同一文件描述符解析元数据头并读取路径；测试覆盖重建中读者快照 |
| CR-03/04：15 天自动刷新/重试 | **取消功能，不再适用** | 用户改为完全手动索引，源代码删除自动刷新入口，加入静态防回归测试 |
| CR-05：JavaScript Regex 阻塞 | **取消功能，不再适用** | 删除独立 regex-search.ts，统一 fzf |
| CR-06：构建可复现性与测试 | **已达到开发期质量门槛** | 提交 package-lock.json、npm ci；macOS CI 18/18 Node 测试、TypeScript、ESLint、Raycast build 通过 |
| CR-07：异常退出残留文件 | **部分完成/后续增强** | 仅在手动重建并获取写锁后，清理超过 24 小时的特定 UUID 临时文件；已有自动测试。尚未引入强杀进程后的端到端恢复测试及 Debug Info 中的遗留文件计数 |
| CR-08：文件/目录过滤与失效路径 | **P2 产品增强** | 文件/目录系统图标与 Finder Actions 已有用户验收；类型筛选与已删除路径提示尚未做 |
| CR-09：README/架构/计划同步 | **已同步当前产品约束** | 中英文 README、索引/架构/开发/追踪文档已检查，无把自动刷新/Regex 描述为当前生效功能 |

## macOS CI 详细范围

工作流 `.github/workflows/index-lifecycle.yml`：

1. `npm ci` 从已提交 `package-lock.json` 安装锁定的依赖；
2. 检查/安装 `fd`；
3. `npm test`：18 个通过，覆盖 v2 原子索引、读写快照、旧 UUID 格式兼容、真实 fd 生成 NUL 路径（中文、换行）、失败 fd 不覆盖旧索引、互斥重建锁、仅手动索引静态守卫、fzf 150 条输出边界和异常临时文件清理；
4. `npx tsc --noEmit`、`npm run lint:code`、`npm run build` 均通过。

`npm run lint`（Raycast Store 作者校验、Prettier 格式）仍为 **continue-on-error** 的非阻塞发布检查，日志有作者用户名 404、Prettier 格式错误。**整个 workflow success 不等于 Store lint success。** 用户已明确表示 Store 作者身份留在发布前处理。

## 合并建议和剩余风险

**技术建议：** PR #3 的核心索引设计、手动工作流、开发期构建检查和用户 GUI 验收已经满足当前阶段要求。可以开始最终审查与合并决策，不再把破坏性故障注入交给用户。

**剩余增强项不应被隐藏：**
- 极端强制终止时，可能残留最后一轮 `.tmp`；下一次用户手动构建会安全清理超过 24 小时的遗留文件。未使用 fsync，不承诺断电后的绝对持久性。
- 旧版 v1 UUID 索引的过渡清理有宽限期，长时间保持打开的旧版窗口仍可能持有过期路径；最新版 v2 搜索使用稳定文件名。
- 文件从磁盘删除后，手动索引依旧包含旧路径直到下次用户重建；未来应改善提示与类型过滤。
- GitHub 上自动测试不能完全替代 macOS 各权限/大目录/多应用 GUI 使用场景。

**操作边界：** 用户未授权直接合并，PR 仍保持 Draft；获得确认后才执行 Merge。合并后可开始 P4：在第三方应用原有 NSOpenPanel/NSSavePanel 中安全导航，不自动提交 Open/Save。
