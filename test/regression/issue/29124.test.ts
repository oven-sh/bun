// https://github.com/oven-sh/bun/issues/29124

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { join } from "path";

// Default bun:test timeout (5s) is not enough: we spawn a child `bun
// build --compile` (~1-2s on release, much longer on ASAN/debug) and
// then run the produced standalone binary.
const testTimeout = isDebug ? Infinity : 60_000;

test(
  "issue #29124 — new Worker(new URL(rel, import.meta.url)) in a compile binary resolves a nested worker",
  { timeout: testTimeout },
  async () => {
    using dir = tempDir("issue-29124", {
      "src/cmd/main.ts": /* js */ `
      new Worker(new URL("../workers/worker.ts", import.meta.url));
    `,
      "src/workers/worker.ts": /* js */ `
      console.log("hello from nested worker");
    `,
    });

    const outfile = join(String(dir), "myapp");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./src/cmd/main.ts", "./src/workers/worker.ts", "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , buildCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildCode).toBe(0);

    await using run = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(runErr).not.toContain("ModuleNotFound");
    expect(runErr).not.toContain("BuildMessage");
    expect(runOut).toContain("hello from nested worker");
    expect(runCode).toBe(0);
  },
);
