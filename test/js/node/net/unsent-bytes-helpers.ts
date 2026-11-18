import type net from "node:net";

/**
 * Bytes that depend on their position and on the seed, so bytes sent from the
 * wrong offset or in the wrong order do not compare equal.
 */
export function patterned(size: number, seed = 0x9e3779b9) {
  const block = Buffer.allocUnsafe(65521);
  let x = seed;
  for (let i = 0; i < block.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    block[i] = x;
  }
  return Buffer.alloc(size, block);
}

/** Counts what `reader` receives and compares each chunk with `expected` at its offset. */
export function receive(reader: net.Socket, expected: Buffer) {
  const state = { received: 0, intact: true };
  reader.on("data", chunk => {
    state.intact &&= chunk.equals(expected.subarray(state.received, state.received + chunk.length));
    state.received += chunk.length;
  });
  return state;
}

/**
 * The values of `bytesWritten` (sent plus queued) that the handle reports,
 * one read per turn of the loop until `written` settles.
 */
export async function bytesWrittenUntil(written: Promise<void>, handle: { bytesWritten: number }) {
  const samples = new Set<number>();
  let pending = true;
  const settle = () => {
    pending = false;
  };
  written.then(settle, settle);
  while (pending) {
    samples.add(handle.bytesWritten);
    await new Promise(resolve => setImmediate(resolve));
  }
  await written;
  return [...samples];
}
