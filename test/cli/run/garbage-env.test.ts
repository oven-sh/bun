import { expect } from "bun:test";
import { describe, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { cc } from "bun:ffi";
import path from "path";

describe("garbage env", () => {
  test("garbage env", async () => {
    const fixturesPath = path.join(import.meta.dirname, "garbage-env-fixtures.ts");

    const bunScript = () => /* ts */ `
      import { cc } from "bun:ffi";
      import path from "path"
      const program = cc({
        source: path.join(import.meta.dirname, "garbage-env.c"),
        symbols: {
          exec_garbage_env: {
            args: [],
            returns: "int",
          },
        },
      });
      program.symbols.exec_garbage_env();
    `;

    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", bunScript()],
      env: { ...bunEnv, BUN_PATH: bunExe() },
      cwd: import.meta.dirname,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
