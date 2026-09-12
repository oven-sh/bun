import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// On Windows a FileSink write goes through an async uv_fs_write. The bytes are
// only readable once that request completes, so write() must hand back a
// promise that settles after the completion, not a plain number.
test.skipIf(!isWindows)("FileSink: awaiting write() and flush() makes the bytes readable", async () => {
  using dir = tempDir("filesink-42435", {});
  for (let i = 0; i < 50; i++) {
    const path = join(String(dir), `${i}.log`);
    const writer = Bun.file(path).writer();
    try {
      const writeResult = writer.write("first\n");
      const flushResult = writer.flush();
      expect(writeResult).toBeInstanceOf(Promise);
      expect(await writeResult).toBe(6);
      await flushResult;
      expect(readFileSync(path, "utf8")).toBe("first\n");
    } finally {
      await writer.end();
    }
  }
});
