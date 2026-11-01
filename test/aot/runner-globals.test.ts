import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const lib = `export const random = () => Math.random();
export const now = () => Date.now();
export const kindOfFetch = () => typeof fetch;
export const later = f => setTimeout(f, 0);
export function plain() { return "real"; }
`;
const asks = (head: string, body: string) =>
  `${head}\nimport * as lib from "./lib.js";\ntest("t", async () => {\n${body}\n});\n`;
const stubsFetch = `vi.stubGlobal("fetch", 1); console.log("SEEN", lib.kindOfFetch()); vi.unstubAllGlobals(); console.log("SEEN", lib.kindOfFetch());`;
const ownRunner = `globalThis.vi = { stubGlobal: (...all) => "own " + all.length, importMock: (...all) => "own " + all.join() };\n`;
const asksOwnRunner = `console.log("SEEN", vi.stubGlobal("fetch", 1), vi.importMock("./lib.js"), lib.kindOfFetch());`;

const cases: [name: string, seen: string[], files: Record<string, string>][] = [
  [
    "stubGlobal of fetch beside an import of bun:test",
    ["SEEN number", "SEEN function"],
    { "m.test.js": asks(`import { mock } from "bun:test";`, stubsFetch) },
  ],
  [
    "stubGlobal of fetch beside an import of vitest",
    ["SEEN number", "SEEN function"],
    { "m.test.js": asks(`import { expect } from "vitest";`, stubsFetch) },
  ],
  ["stubGlobal of fetch without an import", ["SEEN number", "SEEN function"], { "m.test.js": asks("", stubsFetch) }],
  [
    "stubGlobal of Math, Date and setTimeout",
    ["SEEN 0.25 3 stubbed", "SEEN false false"],
    {
      "m.test.js": asks(
        `import { mock } from "bun:test";`,
        `vi.stubGlobal("Math", { random: () => 0.25 }); vi.stubGlobal("Date", class { static now() { return 3; } }); vi.stubGlobal("setTimeout", () => "stubbed");
console.log("SEEN", lib.random(), lib.now(), lib.later(() => {})); vi.unstubAllGlobals(); console.log("SEEN", lib.random() === 0.25, lib.now() === 3);`,
      ),
    },
  ],
  [
    "importMock beside an import",
    ["SEEN function undefined real"],
    {
      "m.test.js": asks(
        `import { mock } from "bun:test";`,
        `const mocked = await vi.importMock("./lib.js"); console.log("SEEN", typeof mocked.plain, mocked.plain(), lib.plain());`,
      ),
    },
  ],
  [
    "stubGlobal in a helper",
    ["SEEN number"],
    {
      "helper.js": `export const stub = () => vi.stubGlobal("fetch", 1);\n`,
      "m.test.js": asks(
        `import { test } from "bun:test";\nimport { stub } from "./helper.js";`,
        `stub(); console.log("SEEN", lib.kindOfFetch());`,
      ),
    },
  ],
  [
    "importMock in a helper",
    ["SEEN function undefined"],
    {
      "helper.js": `export const load = () => vi.importMock("./lib.js");\n`,
      "m.test.js": asks(
        `import { test } from "bun:test";\nimport { load } from "./helper.js";`,
        `const mocked = await load(); console.log("SEEN", typeof mocked.plain, mocked.plain());`,
      ),
    },
  ],
  [
    "a script's own vi beside an import",
    ["SEEN own 2 own ./lib.js function"],
    {
      "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
      "setup.js": ownRunner,
      "m.test.js": asks(`import { test } from "bun:test";`, asksOwnRunner),
    },
  ],
  [
    "a file's own vi",
    ["SEEN own 2 function"],
    {
      "m.test.js": asks(
        `import { test } from "bun:test";\nconst vi = { stubGlobal: (...all) => "own " + all.length };`,
        `console.log("SEEN", vi.stubGlobal("fetch", 1), lib.kindOfFetch());`,
      ),
    },
  ],
];

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

test.concurrent.each(cases)(
  "the runner's names without an import: %s",
  async (name, seen, files) => {
    using dir = tempDir("aot-runner-globals", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "lib.js": lib,
      ...files,
    });
    const [plain, oneProgram, layers] = await Promise.all([
      runTests(String(dir), undefined),
      runTests(String(dir), undefined, "--aot"),
      runTests(String(dir), "TestRunLayers:2", "--aot"),
    ]);
    expect({ name, plain, oneProgram, layers }).toEqual({
      name,
      plain: { seen, exitCode: 0 },
      oneProgram: { seen, exitCode: 0 },
      layers: { seen, exitCode: 0 },
    });
  },
  240_000,
);
