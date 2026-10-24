import { openIndexDataStream } from "./index-files";
import { indexFilePath, type IndexMetadata } from "./index-store";

const MAX_RESULTS = 150;

/**
 * Search the persisted index using JavaScript regular expressions.
 * No fd invocation, content search, or file-tree traversal occurs.
 * The regular expression is matched against the FULL absolute path.
 */
export async function regexSearch(
  index: IndexMetadata,
  query: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!query.trim() || signal?.aborted) return [];
  if (query.length > 256) throw new Error("Regex pattern must be 256 characters or fewer");

  // Do not use the global flag: matching each path must be independent.
  const regex = new RegExp(query, "iu");
  const stream = await openIndexDataStream(indexFilePath(index));
  const results: string[] = [];
  let pending = Buffer.alloc(0);

  try {
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const data = Buffer.concat([pending, chunk as Buffer]);
      let offset = 0;
      while (offset < data.length) {
        const nul = data.indexOf(0, offset);
        if (nul === -1) break;
        const filepath = data.subarray(offset, nul).toString("utf8");
        if (regex.test(filepath)) {
          results.push(filepath);
          if (results.length >= MAX_RESULTS) return results;
        }
        offset = nul + 1;
      }
      pending = data.subarray(offset);
    }
    // The builder always terminates each path with a NUL.
    return signal?.aborted ? [] : results;
  } catch (error) {
    if (signal?.aborted) return [];
    throw error;
  } finally {
    stream.destroy();
  }
}
