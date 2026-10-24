# PathSeek 索引存储与维护说明

> 对应当前开发版实现：[`src/lib/index-store.ts`](../src/lib/index-store.ts)、[`src/lib/fuzzy-search.ts`](../src/lib/fuzzy-search.ts)。本文描述已提交的代码行为，不代表所有 macOS 环境均已实测通过。

## 1. 索引实际存在哪里？

**不在 GitHub 仓库，也不是 Raycast 的加密 LocalStorage 数据库。**

PathSeek 通过 Raycast 官方 `environment.supportPath` API 获取**当前扩展自己的支持目录绝对路径**，相关代码：

```ts
const indexDirectory = environment.supportPath;
const metadataPath = path.join(indexDirectory, "index.json");
```

官方说明：[Raycast Environment API](https://developers.raycast.com/api-reference/environment)；[Raycast Storage API](https://developers.raycast.com/api-reference/storage)。官方建议大型数据使用支持目录中的文件，不要存入 LocalStorage。

**注意：不要假设 supportPath 的绝对路径固定。** 不同安装方式或 Raycast 实现可能有差异，应以运行时返回的路径为准。

### 在 Raycast 里查看精确位置

1. 打开 Raycast，运行 **Index Status**。
2. 打开 Action 菜单，选择 **Open Index Directory in Finder**，直接查看文件。
3. 或选择 **Copy Index Directory Path**，将绝对路径复制出来。

查看索引状态**不会运行 fd**，因此不会触发全盘扫描或重建。

## 2. 文件布局

```text
<environment.supportPath>/
├── index.json                       # 当前生效索引的元数据
├── index-<UUID>.nul                 # 当前生效索引
├── index-<UUID>.nul                 # 历史版本（构建后会清理，异常中断可能暂时残留）
├── index-<UUID>.nul.tmp             # 扫描时临时路径索引；异常退出后可能残留
└── index-<UUID>.json.tmp            # 元数据更新时的临时文件
```

- `index.json` 是正式元数据入口；读取此文件的 `filename` 字段即可确定当前生效的索引文件。
- **当前已恢复安全清理**：重建使用 `proper-lockfile` 跨进程锁防止多个扫描互相清理。只有新索引数据和 `index.json` 成功发布且验证读取后，才删除旧 `.nul` 文件；即使只有一个有效索引，也始终保留它。Issue #1 之前的 ENOENT 已由用户在评论中报告修复。
- 异常退出时仍可能留下临时文件。旧 `.nul` 文件可能增加磁盘占用，不要在不了解 `index.json` 指向的文件时删除。
- 元数据更新采用同目录 `rename()` 发布；不会直接改写旧的索引内容。
- 目前**没有**图形化恢复上一代索引或删除索引的功能，请勿随意手动删除正在使用的文件。

## 3. 元数据格式

`index.json` 示例（内容仅为示意，并非实测产生）：

```json
{
  "version": 1,
  "filename": "index-11111111-2222-4333-8444-555555555555.nul",
  "createdAt": "2026-10-24T08:00:00.000Z",
  "count": 123456,
  "roots": [
    "/Users/example/Projects",
    "/Users/example/Downloads"
  ]
}
```

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `version` | number | 元数据格式版本，目前是 `1` |
| `filename` | string | 当前生效的 `.nul` 文件名 |
| `createdAt` | ISO 8601 字符串 | 最近一次成功完成的重建时间 |
| `count` | number | `fd` 扫描返回的路径项数，不一定等于去重后的实际文件数 |
| `roots` | string[] | 当次构建使用的搜索根目录绝对路径 |

> 目前元数据没有存储排除规则、隐藏文件和符号链接开关的快照。修改插件偏好设置不会自动重建；下一次手动重建才会应用新配置。后续应完善配置快照与索引版本兼容策略。

## 4. 路径索引文件格式

`index-<UUID>.nul` 使用 **UTF-8 编码的绝对路径 + NUL（`0x00`）分隔符**，形式如下：

```text
/Users/example/Projects/linux/Makefile\0
/Users/example/Projects/linux/drivers/tty/serial/8250/8250_core.c\0
/Users/example/Downloads/report.pdf\0
```

上面的 `\0` 用于说明分隔字节，实际文件是二进制 NUL 字节，不是文本的反斜杠和数字 0。通常不建议直接用文本编辑器打开。

使用 NUL 分隔，是因为合法的 macOS 文件名可以包含换行，而不能包含 NUL 字节。

### 只读查看索引内容

先从 **Index Status** 进入该目录，再在终端运行：

```bash
cat index.json
python3 - <<'PY'
import json
from pathlib import Path

meta = json.loads(Path("index.json").read_text(encoding="utf-8"))
data = Path(meta["filename"]).read_bytes()
paths = [x.decode("utf-8", errors="replace") for x in data.split(b"\0") if x]
print("Metadata count:", meta["count"])
print("Actual entries:", len(paths))
for value in paths[:10]:
    print(repr(value))
PY
```

以上是**只读检查**，不会触发 `fd`，也不会重建索引。大索引读取全部字节可能占用较多内存；这段脚本适合初期验证，中大型索引建议采用流式解析工具。

## 5. 构建与搜索数据流

### 手动构建（会遍历配置的文件树）

```text
Rebuild Index
  -> 读取 Search Roots / Include Hidden / Exclusions / Follow Symlinks
  -> 校验根目录存在
  -> 找到 fd 可执行文件
  -> fd --absolute-path --print0 [选项] . <root>
  -> 追加到新的 .nul.tmp 临时文件
  -> rename(.nul.tmp, .nul)
  -> 写入临时 index-UUID.json.tmp
  -> rename(临时元数据, index.json)
  -> 验证当前 index.json 指向新文件，然后清理旧 .nul，始终保留当前一份
```

构建过程中如遇到扫描错误，不会使用部分扫描结果更新 `index.json`；旧索引仍能用于搜索。请注意：当程序在极端时机被系统强制中断时，可能残留临时文件。

### 日常搜索（不会运行 fd）

```text
Search Files
  -> 读取 index.json
  -> 得到当前 index-UUID.nul
  -> 每次查询调用 fzf --read0 --print0 --filter <query>
  -> 最多返回 150 条结果
  -> Finder / Open / Copy Path
```

当前实现每次模糊搜索可能重新读取索引文件；macOS 文件缓存可能减少真实 SSD 读取，但**不能理解为零 I/O**。查询会产生 CPU/内存开销，搜索 UI 目前约 180 ms 防抖。

## 6. 索引生命周期和预期局限

- **15 天按需刷新**：上次成功构建后满 15 天，下一次打开 Search Files 才尝试自动更新（没有常驻定时器或后台服务），自动失败后 24 小时内不重复尝试；未到期的文件变化不会即时同步。
- **手动重建**：仍可随时通过独立的 `Rebuild Index` 命令立即执行。
- **跨启动复用**：只要支持目录的数据未丢失、索引未损坏，重新启动 Raycast 后仍可读取。
- **重建失败**：原则上继续使用先前有效的索引文件。
- **更改搜索范围/排除规则**：必须手动重新构建才生效。
- **多个根目录重叠**：可能造成重复路径；后续需要完善去重。
- **权限不足、外置卷离线、损坏数据、无效 UTF-8**：尚未完成完整实机测试与所有回退策略。

## 7. 隐私和备份

- 索引包含**真实的本机绝对路径**，可能暴露用户主目录名称、项目结构、文件名。
- 索引以普通本地文件保存；**不是加密存储，也不会自动上传 GitHub**。
- 请勿把 `index.json` 或 `.nul` 索引文件直接贴到公开 Issue 中；报告 Bug 时先脱敏。
- 目前无需定期备份索引：用户可以重新运行 `Rebuild Index` 再生成；如需保留旧状态可手动复制支持目录作为备份。

## 8. 诊断索引文件缺失（Issue #1）

运行 Raycast **Debug Info**，在 Action 菜单选择 **Copy Sanitized Debug Info**。报告自动收集：macOS 系统版本、Raycast 版本、Raycast 扩展运行时 Node.js 版本、`index.json` 有效性、当前索引文件是否存在、索引代数及数据文件大小（不包含用户名、完整路径或文件名）。

如果 `active index file` 显示 `missing/unavailable (ENOENT)`，说明 `index.json` 当前引用的数据文件不存在。请先使用 Debug Info 记录诊断，再手动 Rebuild Index；当前加入互斥锁与先发布后清理策略，仍须进行并发与异常中断实测。诊断信息可直接作为 Issue 评论，不要直接粘贴未经脱敏的异常原始路径。

## 9. 对应实现文件

| 文件 | 职责 |
| --- | --- |
| [`src/lib/index-store.ts`](../src/lib/index-store.ts) | 配置、索引位置、构建、写入与读取元数据 |
| [`src/lib/fuzzy-search.ts`](../src/lib/fuzzy-search.ts) | 在现有索引上调用 `fzf` |
| [`src/search-files.tsx`](../src/search-files.tsx) | Raycast 搜索界面和文件 Action |
| [`src/rebuild-index.tsx`](../src/rebuild-index.tsx) | 手动重建界面 |
| [`src/index-status.tsx`](../src/index-status.tsx) | 索引状态和打开实际支持目录 |
| [`src/debug-info.tsx`](../src/debug-info.tsx) | 自动收集脱敏的系统与索引诊断信息 |
