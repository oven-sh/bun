import { BunString_threadIsolatedCopyRefCountDelta } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// BunString__threadIsolatedCopy must not leak a ref on the original
// StringImpl: it returns a +1 isolated copy and leaves the source's
// refcount untouched.
test("BunString__threadIsolatedCopy does not leak a ref on the original StringImpl", () => {
  expect(typeof BunString_threadIsolatedCopyRefCountDelta).toBe("function");

  // A correct implementation leaves the original StringImpl's refcount
  // unchanged once both BunStrings are released. A positive delta means the
  // original ref was leaked.
  for (let i = 0; i < 8; i++) {
    expect(BunString_threadIsolatedCopyRefCountDelta()).toBe(0);
  }
});

// Exercise the real callers (Bun.file / async fs.write) whose Zig-side
// Utf8WithString::make_thread_shareable wrappers were updated alongside the
// C++ fix. With ASAN this would crash on a double-deref if the two sides ever
// disagree on who owns the old StringImpl.
test("make_thread_shareable callers (Bun.file / fs.write) keep refcounts balanced", async () => {
  using dir = tempDir("bunstring-thread-isolated-copy", {
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
    // StringOrBuffer::make_thread_shareable.
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
