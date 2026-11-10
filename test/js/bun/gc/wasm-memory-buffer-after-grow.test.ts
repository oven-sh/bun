import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A WebAssembly.Memory reports its size to the collector when it is created and each growth when it grows. Its
// `buffer` is a view of the same storage. A growth detaches the buffer, so a program that reads the memory from
// JavaScript takes `memory.buffer` again after each growth (Go's wasm_exec.js does). Each new buffer used to be
// counted as a fresh allocation of the whole memory, which requested a collection at nearly every growth.
async function countCollections(takesBuffer: boolean) {
  const script = `
    const memory = new WebAssembly.Memory({ initial: 16, maximum: 2048 });
    let bytes = 0;
    for (let pages = 16; pages < 2048; pages++) {
      memory.grow(1);
      if (${takesBuffer}) bytes = new DataView(memory.buffer).byteLength;
    }
    console.log(bytes || memory.buffer.byteLength);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_JSC_logGC: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const log = stdout + stderr;
  expect(log).toContain(String(2048 * 65536));
  expect(exitCode).toBe(0);
  return (log.match(/=> (Eden|Full)Collection/g) ?? []).length;
}

test("taking memory.buffer after each growth does not count the memory as allocated again", async () => {
  const [withBuffer, withoutBuffer] = await Promise.all([countCollections(true), countCollections(false)]);
  // 128 MB of real growth is still reported.
  expect(withoutBuffer).toBeGreaterThan(0);
  expect(withBuffer).toBeGreaterThan(0);
  // It was over 500 for 2,032 growths.
  expect(withBuffer).toBeLessThan(withoutBuffer + 20);
});
