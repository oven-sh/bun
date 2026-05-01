import { expect, test } from "bun:test";
import { BunString_toThreadSafeRefCountDelta } from "bun:internal-for-testing";
import { bunEnv, bunExe, tempDir } from "harness";

// BunString__toThreadSafe must release the ref it held on the previous
// StringImpl when it installs the isolated copy. Before the fix this
// leaked one ref per call because StringImpl::isolatedCopy() always
// returns a brand-new impl and the old pointer was overwritten without
// ever being deref'd.
test("BunString__toThreadSafe does not leak a ref on the original StringImpl", () => {
  expect(typeof BunString_toThreadSafeRefCountDelta).toBe("function");

  // A correct implementation leaves the original StringImpl's refcount
  // unchanged once the BunString is released. A positive delta means the
  // original ref was leaked.
  for (let i = 0; i < 8; i++) {
    expect(BunString_toThreadSafeRefCountDelta()).toBe(0);
  }
});

// Exercise the real callers (Bun.file / async fs.write) whose Zig-side
// SliceWithUnderlyingString.toThreadSafe wrappers were updated alongside the
// C++ fix. With ASAN this would crash on a double-deref if the two sides ever
// disagree on who owns the old StringImpl.
test("toThreadSafe callers (Bun.file / fs.write) keep refcounts balanced", async () => {
  using dir = tempDir("bunstring-tothreadsafe", {
    "target.txt": "",
  });
  const src = `
    const fs = require("node:fs");
    const { promisify } = require("node:util");
    const path = require("node:path");
    const write = promisify(fs.write);

    const targetPath = path.join(process.env.TEST_DIR, "target.txt");

    // Bun.file(path) routes through SliceWithUnderlyingString.toThreadSafe.
    for (let i = 0; i < 64; i++) {
      const p = targetPath + "";
      const f = Bun.file(p);
      if (typeof f.name !== "string") throw new Error("bad");
    }

    // Async fs.write(fd, string) routes the data string through
    // StringOrBuffer -> SliceWithUnderlyingString.toThreadSafe.
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
