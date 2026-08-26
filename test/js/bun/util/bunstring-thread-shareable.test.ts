import {
  BunString_makeThreadShareableRefCountDelta,
  BunString_threadIsolatedCopyRefCountDelta,
} from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A positive delta means the original StringImpl's ref was leaked; negative, over-released.
test("BunString__threadIsolatedCopy does not leak a ref on the original StringImpl", () => {
  for (let i = 0; i < 8; i++) {
    expect(BunString_threadIsolatedCopyRefCountDelta()).toBe(0);
  }
});

test("BunString__makeThreadShareable on an atom releases exactly the ref it replaces", () => {
  for (let i = 0; i < 8; i++) {
    expect(BunString_makeThreadShareableRefCountDelta()).toBe(0);
  }
});

// Bun.file(path) and async fs.write(fd, string) hand a JS string to another thread through
// Utf8WithString::make_thread_shareable / make_thread_isolated; under ASAN a ref imbalance there is a double-deref.
test("Bun.file / async fs.write string hand-off keeps refcounts balanced", async () => {
  using dir = tempDir("bunstring-thread-shareable", {
    "target.txt": "",
  });
  const src = `
    const fs = require("node:fs");
    const { promisify } = require("node:util");
    const path = require("node:path");
    const write = promisify(fs.write);

    const targetPath = path.join(process.env.TEST_DIR, "target.txt");

    // Bun.file(path) routes through PathLike::make_thread_shareable.
    for (let i = 0; i < 64; i++) {
      const p = targetPath + "";
      const f = Bun.file(p);
      if (typeof f.name !== "string") throw new Error("bad");
    }

    // Async fs.write(fd, string) routes the data string through
    // StringOrBuffer::make_thread_isolated.
    const fd = fs.openSync(targetPath, "w");
    const payload = Buffer.alloc(48, "p").toString();
    let total = 0;
    for (let i = 0; i < 64; i++) {
      const { bytesWritten } = await write(fd, payload);
      total += bytesWritten;
    }
    fs.closeSync(fd);

    console.log(JSON.stringify({ total }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: { ...bunEnv, TEST_DIR: String(dir) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(JSON.stringify({ total: 64 * 48 }));
  expect(exitCode).toBe(0);
});
