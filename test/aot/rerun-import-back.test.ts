import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --rerun-each=3` loads a test file three times in one realm, and what the file imports is loaded once (./fixed-runs/rerun). A file that imports the test
// file back reads what the run that it was linked to exports. TODO: in a compiled run what a file exports is a variable of the program, which is there once, so the
// helper reads what the newest run has stored. Both answers are pinned as they are: whoever changes ours sees it here.
const files = {
  "package.json": `{ "type": "module" }`,
  "helper.ts": `
    import { count, hoisted, name } from "./cycle.test.ts";
    export const early = hoisted();
    export function read() { return name + " " + count; }
    export const state = { loads: 0 };`,
  "cycle.test.ts": `
    import { test } from "bun:test";
    import { early, read, state } from "./helper.ts";
    export function hoisted() { return "hoisted"; }
    export let count = 0;
    export const name = "run " + ++state.loads;
    test("cycle", () => { count++; console.log("OUT", early, "|", read(), "|", name, count); });`,
};

test.each([
  [
    "plain",
    [],
    ["OUT hoisted | run 1 1 | run 1 1", "OUT hoisted | run 1 1 | run 2 1", "OUT hoisted | run 1 1 | run 3 1"],
  ],
  [
    "compiled",
    ["--aot"],
    ["OUT hoisted | run 1 1 | run 1 1", "OUT hoisted | run 2 1 | run 2 1", "OUT hoisted | run 3 1 | run 3 1"],
  ],
])(
  "a file that imports the test file back, %s",
  async (_, flags, lines) => {
    using dir = tempDir("aot-rerun-import-back", files);
    const { stdout, exitCode } = await run([bunExe(), "test", "--rerun-each=3", ...flags], String(dir), bunEnv);
    expect({ lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode }).toEqual({
      lines,
      exitCode: 0,
    });
  },
  120_000,
);
