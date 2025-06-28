import { spawn } from "bun";
import { expect, test } from "bun:test";
import { join } from "path";
import { bunEnv, bunExe } from "../../../harness";

// The purpose of this test is to check that event loop tasks scheduled from
// JavaScriptCore (rather than Bun) keep the process alive.
//
// The problem used to be that Bun would close prematurely when async work was
// scheduled by JavaScriptCore.
//
// At the time of writing, this includes WebAssembly compilation and Atomics
// It excludes FinalizationRegistry since that doesn't need to keep the process alive.
test("es-module-lexer consistently loads", async () => {
  for (let i = 0; i < 10; i++) {
    const { stdout, exited } = spawn({
      cmd: [bunExe(), join(import.meta.dir, "index.ts")],
      env: bunEnv,
    });
    expect(await new Response(stdout).json()).toEqual({
      imports: [
        {
          n: "b",
          s: 19,
          e: 20,
          ss: 0,
          se: 21,
          d: -1,
          a: -1,
        },
      ],
      exports: [
        {
          s: 36,
          e: 37,
          ls: 36,
          le: 37,
          n: "c",
          ln: "c",
        },
      ],
    });
    expect(await exited).toBe(42);
  }
});
