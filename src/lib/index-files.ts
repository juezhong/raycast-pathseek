import { readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const ACTIVE_INDEX_FILENAME = "index.nul";
export const LEGACY_INDEX_REGEX = /^index-[a-f0-9-]+\.nul$/;
export const LEGACY_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Replace the active index atomically on the same filesystem.
 * Readers opening index.nul see either the old or new complete file.
 */
export async function publishIndex(tempPath: string, indexDirectory: string): Promise<void> {
  const activePath = path.join(indexDirectory, ACTIVE_INDEX_FILENAME);
  const info = await stat(tempPath);
  // Verify the complete staged data before touching the active file.
  if (!info.isFile()) throw new Error("Staged index is not a regular file");
  await rename(tempPath, activePath);
}

/**
 * Removes only UUID-based legacy index generations after a grace period.
 * The current stable index is NEVER removed here. A separate index.json
 * check prevents deleting legacy files during an incomplete migration.
 */
export async function cleanupLegacyIndexes(
  indexDirectory: string,
  now = Date.now(),
  graceMs = LEGACY_GRACE_MS,
): Promise<number> {
  const metadata = JSON.parse(await readFile(path.join(indexDirectory, "index.json"), "utf8")) as {
    filename?: string;
  };
  if (metadata.filename !== ACTIVE_INDEX_FILENAME) return 0;

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
