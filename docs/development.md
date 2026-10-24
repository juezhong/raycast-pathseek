# PathSeek 本地开发、调试与测试

> 本文针对当前 GitHub `main` 分支的开发版本；目前还缺少 macOS 用户的首轮实机反馈。

## 1. 开发环境

- macOS、Raycast 已安装且登录。
- Node.js 22.14 或以上、npm 7 或以上。
- Homebrew 安装的 `fd` 和 `fzf`：`brew install fd fzf`。
- 本版新增 `proper-lockfile` npm 依赖，拉取更新后请重新执行 `npm install`。
- Git；建议用较小的测试目录，避免首次测试扫描整个主目录。

Raycast 官方要求参考：[Getting Started](https://developers.raycast.com/basics/getting-started)。

## 2. 获取和加载插件

```bash
git clone https://github.com/juezhong/raycast-pathseek.git
cd raycast-pathseek
npm install
npm run dev
```

`npm run dev` 启动 Raycast 开发扩展，按 Raycast 搜索启动命令：

1. **Index Status**：查看索引状态/复制目录，不触发扫描。
2. **Rebuild Index**：手动触发 `fd` 扫描，第一次使用必须执行一次。
3. **Search Files**：输入任意部分文件名、目录名或路径，切换 Fuzzy / Regex 模式；结果显示 Finder 原生文件/目录图标。
4. **Debug Info**：自动收集 macOS、Raycast、Node.js（扩展运行时）及当前索引文件的状态，复制不含用户绝对路径的诊断报告。

项目首次 `npm install` 会生成依赖锁文件。当前仓库尚未将实测产生的 `package-lock.json` 提交，正式发布前需加入并跑 CI。

## 3. 设置搜索范围

进入 Raycast → Extensions → PathSeek 偏好设置（菜单名称可能随 Raycast 版本变化）：

| 参数 | 作用 | 示例 |
| --- | --- | --- |
| Search Roots | 分号或换行分隔多个绝对/用户目录 | `~/Projects;~/Downloads` |
| Include Hidden Files | 重建时包含隐藏文件和目录 | 默认关闭 |
| Follow Symbolic Links | 重建时进入软链接目录 | 默认关闭 |
| Exclude Patterns | `fd --exclude`，多个模式以英文逗号分隔 | `.git,node_modules` |
| fd Executable | 自动查找失败时填写 `fd` 绝对路径 | `/opt/homebrew/bin/fd` |
| fzf Executable | 自动查找失败时填写 `fzf` 绝对路径 | `/opt/homebrew/bin/fzf` |

**修改任何扫描参数后必须再次执行 Rebuild Index 才会生效。**

## 4. 查看真实存储路径

运行 **Index Status** → **Open Index Directory in Finder** 或 **Copy Index Directory Path**。

路径来自 Raycast 的 `environment.supportPath`，不在 Git 仓库中，具体结构和只读检查方法见 [索引存储说明](index-storage.md)。

## 5. 提交测试反馈

测试任务：[Issue #1 — macOS/Raycast 初版验收](https://github.com/juezhong/raycast-pathseek/issues/1)；新增功能：[Issue #2 — 15 天刷新 / Regex / Finder 图标](https://github.com/juezhong/raycast-pathseek/issues/2)。

请逐项勾选已通过项目；未通过的直接评论：

```text
macOS 版本：
Raycast 版本：
Node.js 版本：
测试位置/功能：
实际行为：
预期行为：
错误日志：
复现步骤：
```

优先从 Raycast 执行 **Debug Info → Copy Sanitized Debug Info**，粘贴到 Issue 评论；如果还要贴原始日志，请注意其中可能包含用户主目录名称、项目敏感名称、绝对路径和凭证，必须先脱敏。**不要上传完整索引文件到公开 Issue。**

## 开发者 fd / fzf 调用追踪

开发版可在偏好设置中开启 **Developer: Trace fd/fzf Calls**（默认关闭）。开启后，通过 **Debug Info → Refresh Diagnostics** 查看最近 fd/fzf 子进程调用的时间、触发原因、参数形态、执行结果与耗时。

**普通搜索不应调用 fd**；Fuzzy 模式由 fzf 查询现有索引；Regex 模式不调用 fzf。追踪只在显式开启时写入本地脱敏日志，详见 [开发者追踪说明](developer-tracing.md)。

### 在独立工作目录测试未合并 PR #3

以下命令不会改变原始 main 工作目录：

```bash
cd /path/to/raycast-pathseek
git fetch origin
git worktree add --detach ../raycast-pathseek-pr3 origin/fix/stable-index-file-atomic-swap
cd ../raycast-pathseek-pr3
npm install
npm run dev
```

PR #3 仍为 Draft，运行此分支测试并不等于它已经合并。请先退出其他工作目录的开发服务，以免两份同名扩展混淆。验证后在 [Issue #5](https://github.com/juezhong/raycast-pathseek/issues/5) 或 [PR #3](https://github.com/juezhong/raycast-pathseek/pull/3) 留下记录。

## 6. 构建与排查

```bash
npm run lint
npm run build
```

如出现模块或 API 类型错误，优先贴出完整第一条报错及堆栈；不要先随意升级全部依赖。

常见故障定位：

| 问题 | 检查点 |
| --- | --- |
| `fd` / `fzf` 无法找到 | `command -v fd`、`command -v fzf`；在偏好设置中配置绝对路径 |
| 找不到搜索结果 | 先确认已构建索引，且指定目录/排除规则允许访问目标路径 |
| 修改搜索范围后结果仍旧 | 手动运行 `Rebuild Index` |
| 找不到数据存储位置 | `Index Status` 复制支持目录路径 |
| `Rebuild Index` 成功但 `Index Status` 报 `ENOENT` | 运行 `Debug Info` 记录 `active index file` 和 `index generation files`；更新代码后重建并复测。旧索引自动清理已暂时停用，避免并发竞态 |
| 部分目录无法读取 | 检查 Raycast 的文件访问权限、磁盘挂载与权限错误 |
| Finder 成功但 Open/Save 对话框未联动 | Dialog Bridge 尚未实现，属于后续阶段 |

## 7. 当前限制和后续开发

- **索引每满 15 天后按需更新**：下次打开 Search Files 才尝试执行 fd 重建（没有常驻服务）；手动 Rebuild Index 随时可用，自动失败 24 小时内不反复尝试。
- 普通键入查询不会运行 `fd`；`fzf` 和正则搜索均从已有索引读取路径（有 CPU、内存与缓存/SSD 读取成本）。
- 索引文件内含绝对路径，按普通本地文件处理，而非 Raycast 加密数据库。
- P4 对话框导航、跨应用兼容、自动下载依赖与正式发布工作尚未完成。
- 本地试用不代表 Raycast Store 的发布验收已经通过。

### 相关文档

- [英文 README](../README.md) / [中文 README](../README.zh-CN.md)
- [总体架构](architecture.md)
- [索引文件格式](index-storage.md)
- [开发计划](../plans/pathseek-development/task_plan.md)
