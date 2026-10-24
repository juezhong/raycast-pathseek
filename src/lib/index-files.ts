import { createReadStream, createWriteStream } from "node:fs";
import { open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const ACTIVE_INDEX_FILENAME = "index.nul";
export const LEGACY_INDEX_REGEX = /^index-[a-f0-9-]+\.nul$/;
export const LEGACY_GRACE_MS = 24 * 60 * 60 * 1000;
const MAGIC = Buffer.from("PSIDX002", "ascii");
const PREFIX_SIZE = 12;
const MAX_HEADER_BYTES = 64 * 1024;

export type SavedIndexMetadata = {
  version: 1 | 2;
  filename: string;
  createdAt: string;
  count: number;
  roots: string[];
  /** Byte offset of the first NUL-delimited path; 0 for older index files. */
  dataOffset?: number;
};

function validateMetadata(raw: unknown): SavedIndexMetadata {
  if (
    !raw || typeof raw !== "object" ||
    !("version" in raw) || raw.version !== 2 ||
    !("count" in raw) || !Number.isSafeInteger(raw.count) || (raw.count as number) < 0 ||
    !("createdAt" in raw) || typeof raw.createdAt !== "string" ||
    !("roots" in raw) || !Array.isArray(raw.roots) ||
    !raw.roots.every((root: unknown) => typeof root === "string")
  ) {
    throw new Error("Invalid PathSeek index header; rebuild the index");
  }
  const payload = raw as Record<string, unknown>;
  return {
    version: 2,
    filename: ACTIVE_INDEX_FILENAME,
    createdAt: payload.createdAt as string,
    count: payload.count as number,
    roots: payload.roots as string[],
  };
}

/**
 * Serialize metadata and NUL-delimited file paths into ONE self-contained
 * index file. It is staged and validated before an atomic rename.
 *
 * [8B ASCII MAGIC][4B little-endian JSON length][JSON][path\0path\0...]
 * The first 12+N bytes MUST be skipped before feeding the path data to fzf.
 */
export async function prepareIndex(
  rawPathsFile: string,
  stagedPath: string,
  metadata: Omit<SavedIndexMetadata, "filename" | "dataOffset">,
): Promise<SavedIndexMetadata> {
  const rawMetadata = {
    version: 2,
    createdAt: metadata.createdAt,
    count: metadata.count,
    roots: metadata.roots,
  };
  const json = Buffer.from(JSON.stringify(rawMetadata), "utf8");
  if (json.length > MAX_HEADER_BYTES) throw new Error("Index metadata exceeds header size limit");
  const prefix = Buffer.alloc(PREFIX_SIZE);
  MAGIC.copy(prefix);
  prefix.writeUInt32LE(json.length, MAGIC.length);
  await writeFile(stagedPath, Buffer.concat([prefix, json]), { flag: "wx" });
  await pipeline(createReadStream(rawPathsFile), createWriteStream(stagedPath, { flags: "a" }));
  const parsed = await readIndexHeader(stagedPath);
  if (parsed.count !== metadata.count || parsed.roots.length !== metadata.roots.length) {
    throw new Error("Index metadata verification failed");
  }
  const info = await stat(stagedPath);
  if (info.size !== (await stat(rawPathsFile)).size + PREFIX_SIZE + json.length) {
    throw new Error("Index payload copy incomplete");
  }
  return parsed;
}

export async function readIndexHeader(indexPath: string): Promise<SavedIndexMetadata> {
  const handle = await open(indexPath, "r");
  try {
    const prefix = Buffer.alloc(PREFIX_SIZE);
    const first = await handle.read(prefix, 0, PREFIX_SIZE, 0);
    if (first.bytesRead !== PREFIX_SIZE || !prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Unsupported index format; run Rebuild Index");
    }
    const length = prefix.readUInt32LE(MAGIC.length);
    if (!length || length > MAX_HEADER_BYTES) throw new Error("Invalid index header length");
    const info = await handle.stat();
    if (PREFIX_SIZE + length > info.size) throw new Error("Incomplete index header");
    const json = Buffer.alloc(length);
    const result = await handle.read(json, 0, length, PREFIX_SIZE);
    if (result.bytesRead !== length) throw new Error("Incomplete index metadata");
    const metadata = validateMetadata(JSON.parse(json.toString("utf8")) as unknown);
    return { ...metadata, dataOffset: PREFIX_SIZE + length };
  } finally {
    await handle.close();
  }
}

/** Atomically replace the fixed active file after preparing a complete index. */
export async function publishIndex(tempPath: string, indexDirectory: string): Promise<void> {
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
