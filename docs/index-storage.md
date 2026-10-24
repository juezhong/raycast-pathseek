# PathSeek 索引格式、生命周期与维护

> 本文描述 **Draft PR #3 中的新索引格式 v2**。合并之前的 \`main\` 仍使用旧的 \`index.json + index-UUID.nul\`。本 PR 必须经过 GitHub CI 和 macOS 实测才考虑合并。
>
> 相关源码：[index-files.ts](../src/lib/index-files.ts)、[index-store.ts](../src/lib/index-store.ts)、[fuzzy-search.ts](../src/lib/fuzzy-search.ts)、[开发者调用追踪](developer-tracing.md)。

## 1. 索引实际存储在哪里？

索引位于 Raycast 提供的 \`environment.supportPath\`，不是 GitHub 项目目录，也不是 LocalStorage 数据库。绝对路径由 Raycast 运行时确定；不要硬编码用户主目录。

在 Raycast 执行 **Index Status → Open Index Directory in Finder** 即可查看；或者选择 **Copy Index Directory Path** 复制路径。索引可暴露私人文件名和绝对路径，不要上传到公开 Issue。

## 2. v2 索引目录与文件格式

\`\`\`text
<environment.supportPath>/
├── index.nul                  # 唯一的当前生效索引（包含元数据头和路径）
├── index-<UUID>.paths.tmp     # fd 扫描中的临时路径数据，正常完成会清理
├── index-<UUID>.nul.tmp       # 已封装头部的临时索引，正常完成后原子替换
├── index.json                # v1 历史元数据，新版不再读取它作为 v2 数据来源
└── index-<UUID>.nul          # v1 旧索引；迁移后至少留 24 小时保护旧窗口
\`\`\`

正式文件 **\`index.nul\`** 不再使用 UUID 文件名，也不会出现「新索引和元数据分别原子提交」的问题。

其二进制布局：

\`\`\`text
[8 字节 ASCII "PSIDX002"]
[4 字节小端 JSON 字节长度 N]
[N 字节 UTF-8 JSON 元数据]
[UTF-8 绝对路径 #1][NUL]
[UTF-8 绝对路径 #2][NUL]
...
\`\`\`

JSON 元数据包含：
- \`version: 2\`
- \`createdAt\`：最近一次成功构建完成的时间（ISO 8601）
- \`count\`：NUL 分隔的路径条目数量
- \`roots\`：此次构建的扫描根目录数组

路径数据使用 NUL（\`0x00\`）而不是换行分隔，允许文件名包含空格、中文与换行。查询时，插件会先读取文件头，**从同一个已打开的文件描述符**按正确偏移量读取路径。无论重建何时发生，都不会把旧文件的元数据偏移量应用到新文件。

## 3. 构建、发布与失败保护

\`\`\`text
Rebuild Index / 到期后的按需刷新
    ↓
独占写入锁（仅防止多个扫描互相交错）
    ↓
fd → index-<UUID>.paths.tmp
    ↓
验证路径数量、末尾 NUL 与输出字节数
    ↓
写入元数据头并封装为 index-<UUID>.nul.tmp
    ↓
验证临时完整索引
    ↓
rename(临时封装文件, index.nul)   ← 唯一的原子发布点
    ↓
清理临时文件，按兼容策略清理 v1 旧索引
\`\`\`

如果扫描、编码、文件校验或写入临时文件失败，已有的 \`index.nul\` 原封不动。只有完整的新索引准备好，才会执行 \`rename\`。

操作系统上已经打开旧 \`index.nul\` 的读者可以继续读旧文件；新读者打开同一个固定路径会读到新文件。**不需要以锁限制读者**。

异常断电与文件系统持久化语义不同于进程级原子可见性；当前仍没有每一层强制 \`fsync\` 保证，因此不能承诺断电后绝对不会丢失最近一次更新。

## 4. v1 升级兼容

旧版本采用：
- \`index.json\`：保存 \`filename/index-UUID.nul\`、构建时间、数量与根目录
- \`index-UUID.nul\`：NUL 分隔路径，文件内没有头部

如果没有 \`index.nul\`，新版本的 \`readIndex()\` 会回退读取旧 \`index.json\` 和对应的 UUID 索引，用户不必因为升级立即丢失搜索能力。

完成首次 v2 重建后，\`index.nul\` 成为新的权威文件。旧 UUID 索引至少保留 **24 小时**，以保护仍在使用旧元数据的搜索窗口。它们只在以后触发维护/重建时按时间清理；旧 \`index.json\` 作为兼容遗留文件暂时保留，但不再决定 v2 的 \`createdAt\` 或 \`count\`。

因此，**首次升级后的短时间内看见两份索引是预期的迁移现象，不代表新版本每次重建都生成两个正式索引。**

## 5. 15 天刷新策略

- 首次明确执行 Rebuild Index 建立索引。
- 自最近一次成功构建起满 15 天，下次打开 Search Files 时尝试刷新（无常驻调度服务）。
- 普通输入搜索词不调用 \`fd\`；两种搜索模式都查询现有索引。
- 现有 24 小时失败退避在 Code Review 中已标为需要改进（CR-04）；不能把它理解为严谨的后台任务保证。
- 修改扫描根目录/排除规则后可以随时手动重建，不必等 15 天。

## 6. 验证与测试

运行 \`Index Status\` 查看格式版本、构建时间、索引条目数、扫描根目录；\`Debug Info\` 允许复制脱敏环境和索引完整性报告。不要将原始索引数据上传至公开 GitHub。

可用 Node 内置测试运行器执行回归测试：

\`\`\`bash
npm test
\`\`\`

当前测试覆盖：
- 元数据和文件路径在同一个正式文件中原子发布；
- 新旧索引头部长度不同时，已打开读者保持一致；
- 临时文件准备或校验失败不覆盖已有数据；
- v1 UUID 旧索引无头部读取；
- 迁移宽限期及清理不会删除 \`index.nul\`。

完整 macOS Raycast GUI、fd 实际大规模扫描、15 天刷新行为仍要在相关 Issue 中验证。

## 7. 相关任务

- [Code Review Issue #4](https://github.com/juezhong/raycast-pathseek/issues/4)
- [功能验收 Issue #2](https://github.com/juezhong/raycast-pathseek/issues/2)
- [固定索引格式 Draft PR #3](https://github.com/juezhong/raycast-pathseek/pull/3)
