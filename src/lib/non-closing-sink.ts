import { Writable } from "node:stream";

/**
 * 为单次扫描创建独立的 Writable，避免将共享压缩输入流反复作为 pipeline
 * 终点，导致 Node.js 在共享流上残留 close 等生命周期监听器。
 *
 * write 回调透传给共享流，维持跨扫描的背压；当前扫描结束时只结束
 * 本适配器，不会关闭下游的 Brotli 压缩输入流。
 */
export function createNonClosingSink(destination: Writable): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (destination.destroyed || destination.writableEnded) {
        callback(new Error("Shared index compression stream is closed"));
        return;
      }
      try {
        destination.write(chunk, callback);
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}
