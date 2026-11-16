import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `const { spyOn: spy } = await import("bun:test")`: what `await` answers around the call is what `import * as all from "bun:test"` names, and what is done with it is in sight.
// A call of import() of a library module used to expose the whole namespace: `mock`, `vi` and `resetModules` of the test runner went out of sight with it, so one such line
// made every module of the run one that may be mocked and every file one that may load again.
// The shapes that begin with OPEN let the namespace or its promise go somewhere: there the run stays open, as before.
// With each shape: mocks any module, spies on objects from somewhere, every file may load again. Each shape is a project of its own.
const lib = `export function answer() { return "real"; }
export const ask = () => answer();
`;

const shapes: Record<string, { open: [boolean, boolean, boolean]; testFile: string }> = {
  "OPEN-a-member-under-a-computed-name": {
    open: [true, true, true],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const name = process.argv.length > 99 ? "mock" : "spyOn";
  const runner: any = await import("bun:test");
  const s = runner[String(name)](lib, "answer").mockReturnValue("spied");
  say(lib.answer(), lib.ask());
  s.mockRestore();
  say(lib.answer(), lib.ask());
});
`,
  },
  "OPEN-the-namespace-is-handed-on": {
    open: [true, true, true],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const keep = (all: any) => all;
  const runner = (globalThis as any).kept = keep(await import("bun:test"));
  const s = runner.spyOn(lib, "answer").mockReturnValue("spied");
  say(lib.answer(), lib.ask());
  s.mockRestore();
  say(lib.answer(), lib.ask());
});
`,
  },
  "OPEN-the-promise-is-kept": {
    open: [true, true, true],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const promise = import("bun:test");
  const runner = await promise;
  const s = runner.spyOn(lib, "answer").mockReturnValue("spied");
  say(lib.answer(), lib.ask());
  s.mockRestore();
  say(lib.answer(), lib.ask());
});
`,
  },
  "OPEN-then-on-the-promise": {
    open: [true, true, true],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  await import("bun:test").then(runner => {
    const s = runner.spyOn(lib, "answer").mockReturnValue("spied");
    say(lib.answer(), lib.ask());
    s.mockRestore();
    say(lib.answer(), lib.ask());
  });
});
`,
  },
  "a-member-read-at-once": {
    open: [false, false, false],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const s = (await import("bun:test")).spyOn(lib, "answer").mockReturnValue("spied");
  say(lib.answer(), lib.ask());
  s.mockRestore();
  say(lib.answer(), lib.ask());
});
`,
  },
  "a-mock-of-a-spelled-module": {
    open: [true, false, false],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const { mock } = await import("bun:test");
  mock.module("./lib", () => ({ answer: () => "mocked", ask: () => "mocked too" }));
  const again = await import("./lib");
  say(again.answer(), again.ask());
});
`,
  },
  "kept-in-a-name": {
    open: [false, false, false],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const runner = await import("bun:test");
  const s = runner.spyOn(lib, "answer").mockReturnValue("spied");
  say(lib.answer(), lib.ask());
  s.mockRestore();
  say(lib.answer(), lib.ask());
});
`,
  },
  "names-taken-out-by-a-pattern": {
    open: [false, false, false],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const { spyOn: spy } = await import("bun:test");
  const s = spy(lib, "answer").mockReturnValue("spied");
  say(lib.answer(), lib.ask());
  s.mockRestore();
  say(lib.answer(), lib.ask());
});
`,
  },
  "node-fs-spied-on": {
    open: [false, false, false],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const { spyOn } = await import("bun:test");
  const fs = await import("node:fs");
  const s = spyOn(fs, "existsSync").mockReturnValue("spied" as never);
  say(fs.existsSync("/"));
  s.mockRestore();
  say(fs.existsSync("/"));
});
`,
  },
  "node-path-by-a-pattern": {
    open: [false, false, false],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const { join, sep } = await import("node:path");
  say(join("a", "b"), sep);
});
`,
  },
  "node-path-by-default": {
    open: [false, false, false],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const { default: path } = await import("node:path");
  say(path.join("a", "b"), typeof path.posix);
});
`,
  },
  "the-reset-of-modules-is-still-seen": {
    open: [false, false, true],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const { vi } = await import("bun:test");
  say(typeof vi.resetModules);
  if (process.argv.length > 99) vi.resetModules();
});
`,
  },
  "under-a-type-assertion": {
    open: [false, false, false],
    testFile: `import { expect, test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const { spyOn: spy } = (await (import("bun:test") as Promise<typeof import("bun:test")>));
  const s = spy(lib, "answer").mockReturnValue("spied");
  say(lib.answer(), lib.ask());
  s.mockRestore();
  say(lib.answer(), lib.ask());
});
`,
  },
};

for (const [name, { open, testFile }] of Object.entries(shapes)) {
  test.concurrent(
    `a library module got by await import(): ${name}`,
    async () => {
      using dir = tempDir("aot-awaited-import-of-the-library", {
        "package.json": `{ "name": "p", "type": "module" }`,
        "lib.ts": lib,
        "a.test.ts": testFile,
      });
      const seenWith = async (...flags: string[]) => {
        const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
        const said = stdout + stderr;
        return {
          seen: {
            lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
            failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|Error/.test(line)),
            exitCode,
          },
          open: [
            said.includes("mocks any module true"),
            said.includes("spies on objects from somewhere true"),
            said.includes("every file may load again"),
          ],
        };
      };
      const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
      expect(plain.seen.lines.length).toBeGreaterThan(0);
      expect(plain.seen.exitCode).toBe(0);
      expect(compiled.seen).toEqual(plain.seen);
      expect(compiled.open).toEqual(open);
    },
    120_000,
  );
}
