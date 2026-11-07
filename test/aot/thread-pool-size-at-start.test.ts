import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

if (!isLinux)
  console.error("SKIPPED: thread-pool-size-at-start.test.ts: it counts the threads of the pool by name, in /proc");

test.skipIf(!isLinux)(
  "an executable sizes its thread pool from the .env file that bun run sizes it from",
  async () => {
    using dir = tempDir("aot-thread-pool-size", {
      "probe.mjs": readFileSync(join(import.meta.dir, "../cli/run/thread-pool-size-fixture.mjs"), "utf8"),
      "main.mjs": `import { print } from "./probe.mjs";\nawait print();\n`,
      ".env": "UV_THREADPOOL_SIZE=3\n",
    });
    const cwd = String(dir);
    const executable = join(cwd, "main");
    // One more than the threads that the pool may have.
    for (let i = 0; i < 4; i++) mkfifo(join(cwd, `fifo${i}`));
    const env = {
      ...bunEnv,
      UV_THREADPOOL_SIZE: undefined,
      GOMAXPROCS: undefined,
      WTF_numberOfProcessorCores: "4",
      BUSY_THREADS: "3",
    };
    const expected = { stdout: `{"UV_THREADPOOL_SIZE":"3","threads":3}\n`, stderr: "", exitCode: 0 };
    expect(await run([bunExe(), "run", "main.mjs"], cwd, env)).toEqual(expected);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
      cwd,
      bunEnv,
    );
    expect(built.exitCode).toBe(0);
    expect(await run([executable], cwd, env)).toEqual(expected);
  },
  240_000,
);
