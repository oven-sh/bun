import { expect, test } from "bun:test";
import { closeSync, openSync, readFileSync, writeSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

function writeLargeFile(path: string, blocks: number, tail: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  const block = Buffer.alloc(1 << 20);
  const fd = openSync(path, "w");
  for (let index = 0; index < blocks; index++) {
    block.fill(index + 1);
    block.writeUInt32LE((index * 2654435761) >>> 0, 12345);
    writeSync(fd, block);
    hasher.update(block);
  }
  writeSync(fd, tail);
  hasher.update(tail);
  closeSync(fd);
  return { size: blocks * block.length + tail.length, digest: hasher.digest("hex") };
}

test("readFileSync reads every byte of a file over 64 MB", () => {
  using dir = tempDir("read-large-file", {});
  const path = join(String(dir), "large.bin");
  const { size, digest } = writeLargeFile(path, 97, "tail");
  const bytes = readFileSync(path);
  expect(bytes.length).toBe(size);
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(digest);
});

test("readFileSync decodes a file over 64 MB", () => {
  using dir = tempDir("read-large-file", {});
  const path = join(String(dir), "large.txt");
  const { size } = writeLargeFile(path, 65, "the end");
  const text = readFileSync(path, "latin1");
  expect(text.length).toBe(size);
  expect(text.endsWith("the end")).toBe(true);
});
