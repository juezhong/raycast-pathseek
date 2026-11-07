import { Transform, type TransformCallback } from "node:stream";

// 相邻记录复用 UTF-8 路径的公共字节前缀，再交由 Brotli 无损压缩。
// 记录格式：[unsigned LEB128 前缀长度][剩余路径字节][NUL]。
const MAX_PATH_BYTES = 1024 * 1024;
const NUL = Buffer.from([0]);

function encodeLength(value: number): Buffer {
  const bytes: number[] = [];
  do {
    const next = value & 0x7f;
    value = Math.floor(value / 128);
    bytes.push(value ? next | 0x80 : next);
  } while (value);
  return Buffer.from(bytes);
}

export class PathPrefixEncoder extends Transform {
  private previous = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentSize = 0;

  private writePath(part: Buffer): void {
    const current = this.fragmentSize
      ? Buffer.concat(
          [...this.fragments, part],
          this.fragmentSize + part.length,
        )
      : Buffer.from(part);
    if (current.length > MAX_PATH_BYTES)
      throw new Error("Index path exceeds size limit");
    let prefix = 0;
    while (
      prefix < this.previous.length &&
      prefix < current.length &&
      this.previous[prefix] === current[prefix]
    )
      prefix++;
    this.push(
      Buffer.concat([encodeLength(prefix), current.subarray(prefix), NUL]),
    );
    this.previous = current;
    this.fragments = [];
    this.fragmentSize = 0;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      let start = 0;
      for (
        let end = chunk.indexOf(0, start);
        end !== -1;
        end = chunk.indexOf(0, start)
      ) {
        this.writePath(chunk.subarray(start, end));
        start = end + 1;
      }
      if (start < chunk.length) {
        const tail = chunk.subarray(start);
        this.fragments.push(Buffer.from(tail));
        this.fragmentSize += tail.length;
        if (this.fragmentSize > MAX_PATH_BYTES)
          throw new Error("Index path exceeds size limit");
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    callback(
      this.fragmentSize ? new Error("Unterminated index path") : undefined,
    );
  }
}

export class PathPrefixDecoder extends Transform {
  private previous = Buffer.alloc(0);
  private prefix = 0;
  private shift = 0;
  private suffixMode = false;
  private fragments: Buffer[] = [];
  private fragmentSize = 0;

  private emitPath(part: Buffer): void {
    const suffix = this.fragmentSize
      ? Buffer.concat(
          [...this.fragments, part],
          this.fragmentSize + part.length,
        )
      : part;
    const current = Buffer.concat([
      this.previous.subarray(0, this.prefix),
      suffix,
    ]);
    if (current.length > MAX_PATH_BYTES)
      throw new Error("Index path exceeds size limit");
    this.push(Buffer.concat([current, NUL]));
    this.previous = current;
    this.prefix = 0;
    this.shift = 0;
    this.suffixMode = false;
    this.fragments = [];
    this.fragmentSize = 0;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      let offset = 0;
      while (offset < chunk.length) {
        if (!this.suffixMode) {
          const byte = chunk[offset++];
          this.prefix += (byte & 0x7f) * 2 ** this.shift;
          if (this.prefix > MAX_PATH_BYTES)
            throw new Error("Invalid path prefix length");
          if (byte & 0x80) {
            this.shift += 7;
            if (this.shift > 21) throw new Error("Invalid path prefix varint");
          } else {
            if (this.prefix > this.previous.length)
              throw new Error("Path prefix exceeds previous path");
            this.suffixMode = true;
          }
        } else {
          const end = chunk.indexOf(0, offset);
          if (end < 0) {
            const rest = chunk.subarray(offset);
            this.fragments.push(Buffer.from(rest));
            this.fragmentSize += rest.length;
            if (this.prefix + this.fragmentSize > MAX_PATH_BYTES)
              throw new Error("Index path exceeds size limit");
            break;
          }
          this.emitPath(chunk.subarray(offset, end));
          offset = end + 1;
        }
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    callback(
      this.suffixMode || this.shift !== 0 || this.prefix !== 0
        ? new Error("Incomplete prefix-encoded index")
        : undefined,
    );
  }
}
