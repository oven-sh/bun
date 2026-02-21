import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import { tempDir } from "harness";
import { join } from "path";

test("fs.promises.readdir with Buffer path does not leak GC protection", async () => {
  using dir = tempDir("readdir-leak", {});
  const base = join(String(dir), "a".repeat(200), "b".repeat(200));
  mkdirSync(base, { recursive: true });

  for (let i = 0; i < 3; i++) {
    const sub = join(base, `sub${i}`);
    mkdirSync(sub);
    for (let j = 0; j < 3; j++) {
      writeFileSync(join(sub, `f${j}`), "x");
    }
  }

  // Warm up
  for (let i = 0; i < 100; i++) {
    await readdir(Buffer.from(base), { recursive: true });
  }
  Bun.gc(true);
  const before = heapStats().protectedObjectCount;

  for (let i = 0; i < 1000; i++) {
    await readdir(Buffer.from(base), { recursive: true });
  }
  Bun.gc(true);
  const after = heapStats().protectedObjectCount;

  // Should not accumulate protected objects — allow a small margin for noise
  expect(after - before).toBeLessThan(10);
});
