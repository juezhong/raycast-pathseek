import { createReadStream, createWriteStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import {
  createBrotliCompress,
  createBrotliDecompress,
  constants as zlibConstants,
} from "node:zlib";
import { PathPrefixEncoder, PathPrefixDecoder } from "./index-codec.ts";

export const ACTIVE_INDEX_FILENAME = "index.nul";
export const LEGACY_INDEX_REGEX = /^index-[a-f0-9-]+\.nul$/;
export const LEGACY_GRACE_MS = 24 * 60 * 60 * 1000;
const MAGIC_V2 = Buffer.from("PSIDX002", "ascii");
const MAGIC_V3 = Buffer.from("PSIDX003", "ascii");
const PREFIX_SIZE = 12;
const MAX_HEADER_BYTES = 64 * 1024;
const STREAMED_DATA_OFFSET = 64 * 1024;

export type SavedIndexMetadata = {
  version: 1 | 2 | 3;
  filename: string;
  createdAt: string;
  count: number;
  roots: string[];
  /** Byte offset of the first NUL-delimited path; 0 for older index files. */
  dataOffset?: number;
};

function validateMetadata(raw: unknown): SavedIndexMetadata {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("version" in raw) ||
    (raw.version !== 2 && raw.version !== 3) ||
    !("count" in raw) ||
    !Number.isSafeInteger(raw.count) ||
    (raw.count as number) < 0 ||
    !("createdAt" in raw) ||
    typeof raw.createdAt !== "string" ||
    !("roots" in raw) ||
    !Array.isArray(raw.roots) ||
    !raw.roots.every((root: unknown) => typeof root === "string")
  ) {
    throw new Error("Invalid PathSeek index header; rebuild the index");
  }
  const payload = raw as Record<string, unknown>;
  return {
    version: raw.version as 2 | 3,
    filename: ACTIVE_INDEX_FILENAME,
    createdAt: payload.createdAt as string,
    count: payload.count as number,
    roots: payload.roots as string[],
    dataOffset:
      typeof payload.dataOffset === "number" &&
      Number.isSafeInteger(payload.dataOffset) &&
      payload.dataOffset >= PREFIX_SIZE &&
      payload.dataOffset <= MAX_HEADER_BYTES
        ? payload.dataOffset
        : undefined,
  };
}

/**
 * Serialize metadata and NUL-delimited file paths into ONE self-contained
 * index file. It is staged and validated before an atomic rename.
 *
 * v3: [8B MAGIC][4B JSON length][JSON][Brotli(prefix-coded NUL paths)].
 * v2 is retained for reading older indexes. Path data is decoded as a stream.
 * The first 12+N bytes MUST be skipped before feeding the path data to fzf.
 */
export async function prepareIndex(
  rawPathsFile: string,
  stagedPath: string,
  metadata: Omit<SavedIndexMetadata, "filename" | "dataOffset">,
): Promise<SavedIndexMetadata> {
  const rawMetadata = {
    version: 3,
    createdAt: metadata.createdAt,
    count: metadata.count,
    roots: metadata.roots,
  };
  const json = Buffer.from(JSON.stringify(rawMetadata), "utf8");
  if (json.length > MAX_HEADER_BYTES)
    throw new Error("Index metadata exceeds header size limit");
  const prefix = Buffer.alloc(PREFIX_SIZE);
  MAGIC_V3.copy(prefix);
  prefix.writeUInt32LE(json.length, MAGIC_V3.length);
  await writeFile(stagedPath, Buffer.concat([prefix, json]), { flag: "wx" });
  let seenPaths = 0;
  let lastByte: number | undefined;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      for (const byte of chunk) if (byte === 0) seenPaths++;
      if (chunk.length) lastByte = chunk[chunk.length - 1];
      callback(null, chunk);
    },
  });
  await pipeline(
    createReadStream(rawPathsFile),
    counter,
    new PathPrefixEncoder(),
    createBrotliCompress({
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
      },
    }),
    createWriteStream(stagedPath, { flags: "a" }),
  );
  if (seenPaths !== metadata.count || (seenPaths > 0 && lastByte !== 0)) {
    throw new Error(
      "Invalid index paths: wrong NUL separator count or trailing byte",
    );
  }
  const parsed = await readIndexHeader(stagedPath);
  if (
    parsed.count !== metadata.count ||
    parsed.roots.length !== metadata.roots.length
  ) {
    throw new Error("Index metadata verification failed");
  }
  const info = await stat(stagedPath);
  if (info.size <= PREFIX_SIZE + json.length && metadata.count > 0) {
    throw new Error("Compressed index payload missing");
  }
  return parsed;
}

/**
 * 为流式重建预留固定大小头部。压缩结果直接追加到 staged 文件，
 * 整个构建过程中不产生完整的未压缩路径临时文件。
 */
export async function createStreamingIndexStage(
  stagedPath: string,
): Promise<void> {
  await writeFile(stagedPath, Buffer.alloc(STREAMED_DATA_OFFSET), {
    flag: "wx",
  });
}

export async function finalizeStreamingIndexStage(
  stagedPath: string,
  metadata: Omit<SavedIndexMetadata, "filename" | "dataOffset">,
): Promise<SavedIndexMetadata> {
  const json = Buffer.from(
    JSON.stringify({
      version: 3,
      createdAt: metadata.createdAt,
      count: metadata.count,
      roots: metadata.roots,
      dataOffset: STREAMED_DATA_OFFSET,
    }),
    "utf8",
  );
  if (PREFIX_SIZE + json.length > STREAMED_DATA_OFFSET)
    throw new Error("Index metadata exceeds reserved header");
  const prefix = Buffer.alloc(PREFIX_SIZE);
  MAGIC_V3.copy(prefix);
  prefix.writeUInt32LE(json.length, MAGIC_V3.length);
  const handle = await open(stagedPath, "r+");
  try {
    if ((await handle.stat()).size <= STREAMED_DATA_OFFSET)
      throw new Error("Missing compressed index payload");
    await handle.write(
      Buffer.concat([prefix, json]),
      0,
      PREFIX_SIZE + json.length,
      0,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  return readIndexHeader(stagedPath);
}

async function readHeader(handle: FileHandle): Promise<SavedIndexMetadata> {
  const prefix = Buffer.alloc(PREFIX_SIZE);
  const first = await handle.read(prefix, 0, PREFIX_SIZE, 0);
  if (
    first.bytesRead !== PREFIX_SIZE ||
    (!prefix.subarray(0, MAGIC_V2.length).equals(MAGIC_V2) &&
      !prefix.subarray(0, MAGIC_V3.length).equals(MAGIC_V3))
  ) {
    throw new Error("Unsupported index format; run Rebuild Index");
  }
  const length = prefix.readUInt32LE(MAGIC_V2.length);
  if (!length || length > MAX_HEADER_BYTES)
    throw new Error("Invalid index header length");
  const info = await handle.stat();
  if (PREFIX_SIZE + length > info.size)
    throw new Error("Incomplete index header");
  const json = Buffer.alloc(length);
  const result = await handle.read(json, 0, length, PREFIX_SIZE);
  if (result.bytesRead !== length) throw new Error("Incomplete index metadata");
  const metadata = validateMetadata(
    JSON.parse(json.toString("utf8")) as unknown,
  );
  const expectedMagic = metadata.version === 3 ? MAGIC_V3 : MAGIC_V2;
  if (!prefix.subarray(0, expectedMagic.length).equals(expectedMagic)) {
    throw new Error("Index header magic and version mismatch");
  }
  const offset = metadata.dataOffset ?? PREFIX_SIZE + length;
  if (offset < PREFIX_SIZE + length || offset > info.size) {
    throw new Error("Invalid index payload offset");
  }
  return { ...metadata, dataOffset: offset };
}

export async function readIndexHeader(
  indexPath: string,
): Promise<SavedIndexMetadata> {
  const handle = await open(indexPath, "r");
  try {
    return await readHeader(handle);
  } finally {
    await handle.close();
  }
}

/**
 * Open exactly ONE file descriptor and parse its own header before streaming
 * its paths. Atomic rebuilds may occur between UI metadata-read and search.
 * Using the offset from THIS open descriptor avoids accidentally applying
 * the previous generation's offset to the new generation.
 */
export async function openIndexDataStream(
  indexPath: string,
): Promise<ReadStream | PathPrefixDecoder> {
  const handle = await open(indexPath, "r");
  try {
    const header =
      path.basename(indexPath) === ACTIVE_INDEX_FILENAME
        ? await readHeader(handle)
        : null;
    const offset = header?.dataOffset ?? 0;
    // 使用同一个 fd，原子替换索引时读者继续访问原快照。
    const source = handle.createReadStream({ start: offset, autoClose: true });
    if (header?.version !== 3) return source;
    const decompressor = createBrotliDecompress();
    const decoder = new PathPrefixDecoder();
    source.on("error", (error) => decompressor.destroy(error));
    decompressor.on("error", (error) => decoder.destroy(error));
    source.pipe(decompressor).pipe(decoder);
    decoder.on("close", () => {
      source.destroy();
      decompressor.destroy();
    });
    return decoder;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** Atomically replace the fixed active file after preparing a complete index. */
export async function publishIndex(
  tempPath: string,
  indexDirectory: string,
): Promise<void> {
  const activePath = path.join(indexDirectory, ACTIVE_INDEX_FILENAME);
  const info = await stat(tempPath);
  if (!info.isFile()) throw new Error("Staged index is not a regular file");
  await readIndexHeader(tempPath);
  await rename(tempPath, activePath);
}

/**
 * Only remove old UUID-format indexes after the new self-contained index is
 * published. Protect recently written files for a compatibility grace period.
 * Never delete index.nul or a file referenced by legacy metadata until after
 * that grace period. Empty/missing legacy state cannot remove the new index.
 */
export async function cleanupLegacyIndexes(
  indexDirectory: string,
  now = Date.now(),
  graceMs = LEGACY_GRACE_MS,
): Promise<number> {
  await readIndexHeader(path.join(indexDirectory, ACTIVE_INDEX_FILENAME));
  let removed = 0;
  for (const filename of await readdir(indexDirectory)) {
    if (!LEGACY_INDEX_REGEX.test(filename)) continue;
    const filePath = path.join(indexDirectory, filename);
    const info = await stat(filePath).catch(() => null);
    if (!info || now - info.mtimeMs < graceMs) continue;
    await rm(filePath, { force: true });
    removed++;
  }
  return removed;
}

/**
 * Clean up abandoned build artifacts only while holding the exclusive rebuild
 * lock. This helper must NEVER run on Search Files startup or ordinary query.
 * The 24-hour safety margin avoids deleting a recently active build's data.
 */
export async function cleanupStaleBuildTemps(
  indexDirectory: string,
  now = Date.now(),
  graceMs = LEGACY_GRACE_MS,
): Promise<number> {
  let removed = 0;
  const tempPattern = /^index-[a-f0-9-]+\.(?:paths|nul)\.tmp$/;
  for (const filename of await readdir(indexDirectory)) {
    if (!tempPattern.test(filename)) continue;
    const fullPath = path.join(indexDirectory, filename);
    const info = await stat(fullPath).catch(() => null);
    if (!info || !info.isFile() || now - info.mtimeMs < graceMs) continue;
    await rm(fullPath, { force: true });
    removed++;
  }
  return removed;
}
