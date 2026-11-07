import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";

const MAX_PATH_BYTES = 1024 * 1024;

export type SelectiveSymlinkTarget = {
  aliasPath: string;
  realPath: string;
};

export type SelectiveSymlinkDiscovery = {
  targets: SelectiveSymlinkTarget[];
  linksSeen: number;
  linksSkipped: number;
};

/**
 * 只展开指定目录的直接子项中指向目录的软链接。
 * 扫描目标时仍禁止 fd --follow，防止目标内部的软链接再次递归展开。
 */
export async function discoverSelectiveSymlinks(
  directory: string,
  includeHidden: boolean,
): Promise<SelectiveSymlinkDiscovery> {
  const info = await lstat(directory);
  if (!info.isDirectory()) {
    throw new Error("Selective symlink folder must be a real directory");
  }
  const result: SelectiveSymlinkDiscovery = {
    targets: [],
    linksSeen: 0,
    linksSkipped: 0,
  };

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    if (!includeHidden && entry.name.startsWith(".")) continue;
    result.linksSeen++;
    const aliasPath = path.join(directory, entry.name);
    try {
      const targetInfo = await stat(aliasPath);
      if (!targetInfo.isDirectory()) {
        result.linksSkipped++;
        continue;
      }
      const realPath = await realpath(aliasPath);
      result.targets.push({ aliasPath, realPath });
    } catch (error) {
      // 失效或不可访问的链接不能递归，跳过并记录数量。
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ELOOP") {
        result.linksSkipped++;
        continue;
      }
      throw error;
    }
  }

  return result;
}

/** 将目标的真实路径还原成指定软链接路径；路径按字节处理，支持换行和中文。 */
export class AliasPathMapper extends Transform {
  private readonly real: Buffer;
  private readonly alias: Buffer;
  private readonly prefix: Buffer;
  private fragments: Buffer[] = [];
  private fragmentSize = 0;

  constructor(target: SelectiveSymlinkTarget) {
    super();
    const real = path.resolve(target.realPath);
    this.real = Buffer.from(real, "utf8");
    this.alias = Buffer.from(path.resolve(target.aliasPath), "utf8");
    this.prefix = Buffer.from(real === "/" ? "/" : real + "/", "utf8");
  }

  private appendPath(part: Buffer): void {
    const current = this.fragmentSize
      ? Buffer.concat([...this.fragments, part], this.fragmentSize + part.length)
      : part;
    if (current.length > MAX_PATH_BYTES) throw new Error("Selective symlink path too long");

    const mapped = current.equals(this.real)
      ? this.alias
      : current.subarray(0, this.prefix.length).equals(this.prefix)
        ? Buffer.concat([this.alias, Buffer.from("/"), current.subarray(this.prefix.length)])
        : null;
    if (!mapped) throw new Error("fd emitted a path outside the selected symlink target");
    this.push(Buffer.concat([mapped, Buffer.from([0])]));
    this.fragments = [];
    this.fragmentSize = 0;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      let start = 0;
      for (let end = chunk.indexOf(0, start); end !== -1; end = chunk.indexOf(0, start)) {
        this.appendPath(chunk.subarray(start, end));
        start = end + 1;
      }
      if (start < chunk.length) {
        const tail = chunk.subarray(start);
        this.fragments.push(Buffer.from(tail));
        this.fragmentSize += tail.length;
        if (this.fragmentSize > MAX_PATH_BYTES) throw new Error("Selective symlink path too long");
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    callback(this.fragmentSize ? new Error("Unterminated fd path in selective symlink scan") : undefined);
  }
}
