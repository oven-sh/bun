// Where `bun test --aot` answers otherwise than `bun test` and docs/compiler/compatibility.mdx says so. Each case holds what the compiled run prints today, and says what `bun test` prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const saysNothing = `let mode = "strict";\ntry { undeclared = 1; mode = "sloppy"; } catch {}\nconsole.log("plain", mode);\n`;

const cases: Record<string, { files: Record<string, string>; printed: string[] }> = {
  // `bun test`: first | plain strict | middle | mock. No statement counts as loading a module that a mock names: the mock may have been made by a preload or by an earlier test file.
  "a mock is made behind the statement that imports the module": {
    files: {
      "a_test.mjs": `import { mock, test } from "bun:test";\nimport { name } from "./middle.mjs";\nmock.module("./middle.mjs", () => ({ name: "mock" }));\ntest("the name", () => console.log(name, typeof require("./middle.mjs")));\n`,
      "middle.mjs": `import "./first.mjs";\nimport "./plain.cjs";\nconsole.log("middle");\nexport const name = "middle";\n`,
      "first.mjs": `console.log("first");\nexport {};\n`,
      "plain.cjs": saysNothing,
    },
    printed: ["plain sloppy", "first", "middle", "mock object"],
  },
  // `bun test`: real | plain strict | object. The build does not know when load() is called.
  "a file that says nothing of its kind stands behind a CommonJS file that holds a require of it": {
    files: {
      "a_test.mjs": `import { test } from "bun:test";\nimport real from "./real.cjs";\nimport "./plain.cjs";\ntest("what the require answers", () => console.log(typeof real.load()));\n`,
      "real.cjs": `console.log("real");\nexports.load = () => require("./plain.cjs");\n`,
      "plain.cjs": saysNothing,
    },
    printed: ["real", "plain sloppy", "object"],
  },
  // `bun test`: true member. tsc: TS2631.
  "the name of a namespace in its own block, behind a store to the name": {
    files: {
      "a_test.ts": `import { test } from "bun:test";\nnamespace Box {\n  export var size = "member";\n  export function self() { return Box; }\n}\nconst self = Box.self, first = Box;\n// @ts-ignore\nBox = { size: "another object" };\ntest("what self() returns", () => console.log(self() === first, self().size));\n`,
    },
    printed: ["false another object"],
  },
};

test.concurrent.each(Object.entries(cases))("%s", async (_, { files, printed }) => {
  using dir = tempDir("declared-of-a-test-run", { "package.json": `{ "name": "p" }`, ...files });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  expect({
    printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
    exitCode,
    stderr: exitCode ? stderr : "",
  }).toEqual({
    printed,
    exitCode: 0,
    stderr: "",
  });
});
