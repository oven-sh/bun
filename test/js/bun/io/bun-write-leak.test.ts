import { expect, test } from "bun:test";
import path from "node:path";

import "harness";
import { bunEnv, bunExe, isASAN, isDebug, tempDir, tempDirWithFiles } from "harness";

// https://github.com/oven-sh/bun/issues/10588
test(
  "Bun.write should not leak the output data",
  async () => {
    const dir = tempDirWithFiles("bun-write-leak-fixture", {
      "bun-write-leak-fixture.js": await Bun.file(path.join(import.meta.dir, "bun-write-leak-fixture.js")).text(),
      "out.bin": "here",
    });

    const dest = path.join(dir, "out.bin");
    expect([path.join(dir, "bun-write-leak-fixture.js"), dest]).toRun();
  },
  30 * 1000,
);

// https://github.com/oven-sh/bun/issues/10686
test(
  "Bun.write(path, fetchResponse) should not hang or leak",
  async () => {
    using dir = tempDir("bun-write-response-leak", {});

    // Debug/ASAN builds have much higher baseline RSS; scale the ceiling
    // accordingly. The leak this covers was ~4 MB/iteration × 100 iterations,
    // so even the generous debug ceiling is well under the pre-fix growth.
    const maxRSS = isASAN || isDebug ? 1024 : 256;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--smol",
        path.join(import.meta.dir, "bun-write-response-leak-fixture.js"),
        String(dir),
        String(maxRSS),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(60_000),
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Before the fix the child would hang inside `await Bun.write(...)` after
    // the first couple of iterations (Response GC'd -> body discarded -> promise
    // never resolves) and be killed by the AbortSignal above.
    expect(stderr).toBe("");
    expect(stdout.trim()).toStartWith('{"ok":true');
    expect(exitCode).toBe(0);
  },
  90 * 1000,
);
