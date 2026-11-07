import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  ACTIVE_INDEX_FILENAME,
  readIndexHeader,
  type SavedIndexMetadata,
} from "./index-files.ts";

/**
 * Raycast 已经为每个扩展提供独立的 supportPath。
 * 开发模式和本地安装模式不再额外划分索引目录。
 */
export const OLD_DEVELOPMENT_INDEX_FOLDER = "index-development-v3";

export type ActiveIndexMetadata = SavedIndexMetadata & {
  /** 旧版本的只读兼容标记；新建索引不会写入旧目录。 */
  legacyDevelopmentLocation?: true;
};

export function legacyDevelopmentIndexDirectory(supportPath: string): string {
  return path.join(supportPath, OLD_DEVELOPMENT_INDEX_FOLDER);
}

export function indexPathAt(
  supportPath: string,
  metadata: ActiveIndexMetadata,
): string {
  // 不允许从文件头读取任意文件路径。
  if (
    metadata.filename !== ACTIVE_INDEX_FILENAME &&
    !/^index-[a-f0-9-]+\.nul$/.test(metadata.filename)
  ) {
    throw new Error("Invalid index filename");
  }
  const directory = metadata.legacyDevelopmentLocation
    ? legacyDevelopmentIndexDirectory(supportPath)
    : supportPath;
  return path.join(directory, metadata.filename);
}

async function readIndexAt(
  directory: string,
  supportPath: string,
  oldDevelopment: boolean,
): Promise<ActiveIndexMetadata | null> {
  const marker = oldDevelopment
    ? { legacyDevelopmentLocation: true as const }
    : {};

  // 自描述的单文件索引优先；文件存在但损坏时必须报错，不能静默回退。
  try {
    return {
      ...(await readIndexHeader(path.join(directory, ACTIVE_INDEX_FILENAME))),
      ...marker,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // 历史 v1 的 metadata 与数据文件配对兼容，只读、不迁移、不清理。
  let text: string;
  try {
    text = await readFile(path.join(directory, "index.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const data: unknown = JSON.parse(text);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    data.version !== 1 ||
    !("filename" in data) ||
    typeof data.filename !== "string" ||
    !("count" in data) ||
    !Number.isSafeInteger(data.count) ||
    (data.count as number) < 0 ||
    !("roots" in data) ||
    !Array.isArray(data.roots) ||
    !(data.roots as unknown[]).every((value) => typeof value === "string") ||
    !("createdAt" in data) ||
    typeof data.createdAt !== "string"
  ) {
    throw new Error("Invalid legacy index metadata; rebuild the index");
  }
  const metadata: ActiveIndexMetadata = {
    ...(data as SavedIndexMetadata),
    dataOffset: 0,
    ...marker,
  };
  await access(indexPathAt(supportPath, metadata));
  return metadata;
}

/**
 * 新的 supportPath 根目录永远优先；仅在没有现有索引时读取旧开发目录。
 * 此函数禁止产生文件、迁移或删除：退出搜索不会更改磁盘状态。
 * 下次用户主动 Build Index 才在统一目录发布新索引。
 */
export async function readStoredIndex(
  supportPath: string,
): Promise<ActiveIndexMetadata | null> {
  const current = await readIndexAt(supportPath, supportPath, false);
  if (current) return current;
  return readIndexAt(
    legacyDevelopmentIndexDirectory(supportPath),
    supportPath,
    true,
  );
}
