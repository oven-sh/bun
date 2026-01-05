// https://github.com/oven-sh/bun/issues/8254
// Bun.write() should correctly write files larger than 2GB without data corruption

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.write() should write past 2GB boundary without corruption", async () => {
  using tmpbase = tempDir("issue-8254", {});

  const TWO_GB = 2 ** 31;
  const CHUNK_SIZE = 1024 * 1024; // 1MB
  // Force a second write iteration by crossing the 2GB boundary
  const NUM_CHUNKS = Math.floor(TWO_GB / CHUNK_SIZE) + 1;
  const path = join(tmpbase, "large-file.bin");

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < NUM_CHUNKS; i++) {
    const chunk = new Uint8Array(CHUNK_SIZE);
    chunk.fill(i % 256);
    chunks.push(chunk);
  }

  const blob = new Blob(chunks);
  const written = await Bun.write(path, blob);

  expect(written).toBeGreaterThan(TWO_GB);

  const file = Bun.file(path);

  // Check bytes just before and after 2GB boundary
  const positions = [TWO_GB - 1, TWO_GB, TWO_GB + 1];

  for (const pos of positions) {
    const buf = new Uint8Array(await file.slice(pos, pos + 1).arrayBuffer());

    const expected = Math.floor(pos / CHUNK_SIZE) % 256;
    expect(buf[0]).toBe(expected);
  }
});
