// `const root = typeof globalThis !== "undefined" ? globalThis : self`, `helper(globalThis)`, `globalThis[name]`: the global object holds `Bun`, and `Bun.jest(path)` answers the test runner. So a file of
// the tests that let the global object or `Bun` go counted as one that lets the runner go: a spy under any name, a mock of any module, and every file could load again.
// That was a courtesy and no proof. Whoever gets the runner where the build does not see it is refused by what it calls, aloud, with what to write instead. Only an object OF the runner that goes somewhere opens the run.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const through = `take(globalThis).Bun.jest(import.meta.path)`;
const uses: Record<string, { text: string; plain: string; compiled?: RegExp }> = {
  "one of two names for the global object": {
    text: `const root = typeof globalThis !== "undefined" ? globalThis : self; say(typeof root.setTimeout);`,
    plain: "function",
  },
  "the global object goes to a function": { text: `say(typeof take(globalThis).setTimeout);`, plain: "function" },
  "a global under a name that is made": {
    text: `say(typeof globalThis[["set", "Timeout"].join("")]);`,
    plain: "function",
  },
  "Bun goes to a function": { text: `say(typeof take(Bun).version);`, plain: "string" },
  // From an answer to a refusal, each with what to write instead.
  "a spy through the global object": {
    text: `${through}.spyOn(lib, "total").mockReturnValue("spied"); say(read());`,
    plain: "spied",
    compiled:
      /Cannot spy on 'total' of ".*lib\.js" because the build didn't see a test spy on it\. Spell out the module and the name where the spy is made: import \* as module from "<path>"; spyOn\(module, "total"\)/,
  },
  "a spy through Bun": {
    text: `take(Bun).jest(import.meta.path).spyOn(lib, "total").mockReturnValue("spied"); say(read());`,
    plain: "spied",
    compiled: /Cannot spy on 'total' of ".*lib\.js" because the build didn't see a test spy on it\./,
  },
  "a mock through the global object": {
    text: `${through}.mock.module("./lib.js", () => ({ total: () => "mocked" })); say(read());`,
    plain: "mocked",
    compiled:
      /mock\(module, fn\) cannot replace ".*lib\.js" because the build didn't see a test mock it\. Spell out the module's path where the mock is made: mock\.module\("<path>", factory\)/,
  },
  "a reset through the global object": {
    text: `await import("./counted.js"); ${through}.vi.resetModules(); await import("./counted.js"); say(globalThis.runs);`,
    plain: "2",
    compiled: /Cannot load '.*\.js' again after vi\.resetModules\(\): the build found nothing that calls it/,
  },
};

for (const [name, { text, plain, compiled }] of Object.entries(uses))
  test.concurrent(name, async () => {
    using dir = tempDir("aot-leads-to-the-runner", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "lib.js": `export function total() { return "real"; }\n`,
      "reader.js": `import { total } from "./lib.js";\nexport const read = () => total();\n`,
      "counted.js": `globalThis.runs = (globalThis.runs ?? 0) + 1;\n`,
      "a.test.js": `import { test } from "bun:test";\nimport * as lib from "./lib.js";\nimport { read } from "./reader.js";\nconst take = it => it;\nconst say = it => console.error("SEEN " + it);\ntest("t", async () => { ${text} });\n`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_JSC_logAOTPhaseTimes: "1",
      });
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ")),
        refused: compiled !== undefined && lines.some(line => compiled.test(line)),
        found: [
          ...new Set(
            lines.flatMap(
              line =>
                /\| (mocks any module (?:true|false)) \|.*\| (spies on objects from somewhere (?:true|false))/
                  .exec(line)
                  ?.slice(1) ?? [],
            ),
          ),
        ],
        everyFileMayLoadAgain: lines.some(line => line.includes("every file may load again")),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({
      seen: ["SEEN " + plain],
      refused: false,
      found: [],
      everyFileMayLoadAgain: false,
      exitCode: 0,
    });
    expect(await seenWith("--aot")).toEqual({
      seen: compiled ? [] : ["SEEN " + plain],
      refused: compiled !== undefined,
      found: ["mocks any module false", "spies on objects from somewhere false"],
      everyFileMayLoadAgain: false,
      exitCode: compiled ? 1 : 0,
    });
  });
