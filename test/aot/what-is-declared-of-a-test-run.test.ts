// Where `bun test --aot` answers otherwise than `bun test` and docs/compiler/compatibility.mdx says so. Each case holds what the compiled run prints today, and says what `bun test` prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const cases: Record<string, { files: Record<string, string>; printed: string[] }> = {
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
