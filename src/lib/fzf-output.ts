/**
 * NUL-delimited fzf output accumulator. The result cap is strict even when
 * stdout arrives in large chunks or multiple queued "data" callbacks.
 */
export const MAX_FZF_RESULTS = 150;
// 与 v3 路径解码器的单条路径限制一致；拒绝异常的无限 stdout 记录。
export const MAX_FZF_PATH_BYTES = 1024 * 1024;

export type FzfOutputState = {
  pending: Buffer;
  results: string[];
  limitReached: boolean;
};

export function createFzfOutputState(): FzfOutputState {
  return { pending: Buffer.alloc(0), results: [], limitReached: false };
}

export function appendFzfOutputChunk(
  state: FzfOutputState,
  chunk: Buffer,
  maxResults = MAX_FZF_RESULTS,
): void {
  if (state.limitReached || !chunk.length) return;
  const data = state.pending.length
    ? Buffer.concat([state.pending, chunk])
    : chunk;
  let offset = 0;

  while (offset < data.length) {
    const boundary = data.indexOf(0, offset);
    if (boundary === -1) break;
    if (boundary - offset > MAX_FZF_PATH_BYTES)
      throw new Error("fzf output path exceeds size limit");
    const filename = data.subarray(offset, boundary).toString("utf8");
    if (filename) state.results.push(filename);
    offset = boundary + 1;

    if (state.results.length >= maxResults) {
      state.limitReached = true;
      state.pending = Buffer.alloc(0);
      return;
    }
  }
  if (data.length - offset > MAX_FZF_PATH_BYTES)
    throw new Error("fzf output path exceeds size limit");
  state.pending = Buffer.from(data.subarray(offset));
}
