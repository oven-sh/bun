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
          type: "static",
          specifier: "b",
          phase: null,
          start: 19,
          end: 20,
          importStart: 0,
          importEnd: 21,
          attributes: null,
          attributesStart: -1,
          typeOnly: false,
        },
      ],
      exports: [
        {
          type: "direct",
          name: "c",
          localName: "c",
          start: 36,
          end: 37,
          localStart: 36,
          localEnd: 37,
          exportStart: 23,
          typeOnly: false,
        },
      ],
    });
    expect(await exited).toBe(42);
  }
});
