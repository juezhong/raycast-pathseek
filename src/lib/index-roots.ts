import { LocalStorage } from "@raycast/api";
import { lstat, stat } from "node:fs/promises";
import { normalizeIndexRoots } from "./index-root-paths";

export { normalizeIndexRoots } from "./index-root-paths";

const ROOTS_KEY = "configured-index-roots-v1";
const SYMLINK_DIRECTORY_KEY = "configured-selective-symlink-folder-v1";

/**
 * Reading the configured roots does NOT scan any directory and never runs fd.
 * A saved selection wins; old pre-setup indexes remain backward compatible
 * using their embedded roots until users explicitly change folders.
 */
export async function getConfiguredIndexRoots(
  previousRoots: string[] = [],
): Promise<string[]> {
  const stored = await LocalStorage.getItem<string>(ROOTS_KEY);
  if (stored !== undefined) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (
        Array.isArray(parsed) &&
        parsed.every((entry) => typeof entry === "string")
      ) {
        return normalizeIndexRoots(parsed);
      }
    } catch {
      // Invalid stored configuration is treated as unconfigured.
    }
    return [];
  }
  return normalizeIndexRoots(previousRoots);
}

/** Persist only an explicit folder selection, never start an index build. */
export async function saveConfiguredIndexRoots(
  folders: string[],
): Promise<string[]> {
  const roots = normalizeIndexRoots(folders);
  if (!roots.length) throw new Error("Choose at least one folder to index.");
  for (const root of roots) {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error("Not a directory: " + root);
  }
  await LocalStorage.setItem(ROOTS_KEY, JSON.stringify(roots));
  return roots;
}

/** 只允许配置一个真实目录，用于发现其直接子项中的目录软链接。 */
export async function getConfiguredSymlinkDirectory(): Promise<string | null> {
  const stored = await LocalStorage.getItem<string>(SYMLINK_DIRECTORY_KEY);
  return stored ? (normalizeIndexRoots([stored])[0] ?? null) : null;
}

export async function saveConfiguredSymlinkDirectory(
  folder: string | null,
): Promise<string | null> {
  const normalized = folder ? normalizeIndexRoots([folder])[0] : undefined;
  if (normalized) {
    const info = await lstat(normalized);
    if (!info.isDirectory()) {
      throw new Error("Select a regular folder containing symlink shortcuts");
    }
  }
  await LocalStorage.setItem(SYMLINK_DIRECTORY_KEY, normalized ?? "");
  return normalized ?? null;
}
