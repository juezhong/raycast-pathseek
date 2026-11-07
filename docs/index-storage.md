# PathSeek 索引存储

PathSeek 的索引保存在 Raycast 提供的 `environment.supportPath` 目录中，不在 Git 仓库，也不是 Raycast 加密的 LocalStorage。运行 **View Index Status** 可以查看构建时间、路径数量和存储位置。

## 手动索引

- 第一次运行 **Build Index**，自行选择一个或多个目录，再明确提交建立索引。
- 修改目录或扫描选项后，仍须手动执行 **Rebuild Index Now** 才会更新搜索结果。
- 打开 Raycast、搜索、查看状态、修改目录以及长时间不使用时，**都不会自动启动 `fd`**。
- 搜索通过 `fzf` 读取已发布的索引；不会为了搜索词重新扫描文件系统。

## v3 压缩格式（当前）

当前新建的索引仍为 `index.nul`，但文件内容采用路径字节公共前缀编码 + Brotli 最高质量无损压缩。重建时直接将 `fd` 的 NUL 路径流编码压缩后写入临时索引，不再保留一份巨大的原始路径临时文件。

流式构建使用固定 64KiB 的预留头部。构建完成后写入记录数量及索引根目录，并原子替换旧索引。搜索时仅流式解压和恢复路径，不向磁盘写出解压文件。由于每次模糊搜索仍需扫描路径流，压缩后搜索可能更慢。

### 压缩流程

```text
fd --print0 → PathPrefixEncoder → Brotli(quality=11) → staged index
index.nul → Brotli Decoder → PathPrefixDecoder → fzf --read0
```

单条路径使用前条路径 UTF-8 字节的共享前缀长度（LEB128）和余下字节编码，再以 NUL 分隔。保持 UTF-8、换行文件名等完整字节，不做有损归一化。没有要求额外安装压缩程序。

### 兼容

## v3 压缩格式（当前）

v2 旧索引仍采用原有的 NUL 分隔绝对路径格式。

```text
[8 bytes: "PSIDX002"]
[4 bytes: little-endian JSON header length]
[JSON metadata: version, createdAt, count, roots]
[UTF-8 absolute path][NUL]
[UTF-8 absolute path][NUL]
...
```

使用 NUL 分隔可以正确处理路径中的中文、空格和换行。新文件先写入临时路径并校验，然后原子替换当前 `index.nul`；同一份打开的文件描述符供读者读取头部与路径，避免读取过程中混用新旧索引。

对早期 v1 格式 `index.json + index-<UUID>.nul` 保留兼容读取；在新版构建成功、经过宽限期后，旧数据可被清理。失败的构建不会在发布前破坏当前索引。

**隐私注意：** 尽管索引已压缩，它仍包含真实文件名与绝对路径，不要把 `index.nul` 上传到公开 Issue。排查问题请使用 **View Diagnostics → Copy Sanitized Debug Info**。
