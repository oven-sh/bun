// https://github.com/oven-sh/bun/issues/8254
// Bun.write() should correctly write files larger than 2GB without data corruption

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.write() should write past 2GB boundary without corruption", async () => {
  using tmpbase = tempDir("issue-8254", {});

  const TWO_GB = 2 ** 31;
  const CHUNK_SIZE = 1024 * 1024; // 1MB
  // Force a second write iteration by crossing the 2GB boundary (write()
  // on Linux and Darwin both cap a single call below 2^31, so one extra
  // chunk guarantees Bun.write's partial-write loop runs at least twice).
  const NUM_CHUNKS = Math.floor(TWO_GB / CHUNK_SIZE) + 1;
  const TOTAL = NUM_CHUNKS * CHUNK_SIZE;
  const path = join(tmpbase, "large-file.bin");

  // Two distinct fill values are enough to detect a skipped or duplicated
  // chunk at the boundary, and every byte we assert on is non-zero so a
  // zero-filled tail (the original #8254 symptom) cannot pass by accident.
  // Backing the 2049-part Blob with two shared 1MB buffers instead of 256
  // drops per-run setup from 256MB of filled pages to 2MB.
  const a = new Uint8Array(CHUNK_SIZE).fill(0xaa);
  const b = new Uint8Array(CHUNK_SIZE).fill(0xbb);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < NUM_CHUNKS; i++) {
    chunks.push(i & 1 ? b : a);
  }

  const blob = new Blob(chunks);
  expect(blob.size).toBe(TOTAL);

  const written = await Bun.write(path, blob);
  expect(written).toBe(TOTAL);

  const file = Bun.file(path);
  expect(file.size).toBe(TOTAL);

  // One read spanning the 2GB boundary: last two bytes of chunk 2047 (0xbb)
  // and first two bytes of chunk 2048 (0xaa). Under the original bug the
  // preallocated tail past MAX_RW_COUNT stayed zero, so this read back as
  // [0, 0, 0, 0].
  const around = new Uint8Array(await file.slice(TWO_GB - 2, TWO_GB + 2).arrayBuffer());
  expect([...around]).toEqual([0xbb, 0xbb, 0xaa, 0xaa]);

  // First and last byte: chunk 0 and chunk 2048 are both even -> 0xaa.
  const head = new Uint8Array(await file.slice(0, 1).arrayBuffer());
  const tail = new Uint8Array(await file.slice(TOTAL - 1, TOTAL).arrayBuffer());
  expect({ head: [...head], tail: [...tail] }).toEqual({ head: [0xaa], tail: [0xaa] });
}, 30_000);
