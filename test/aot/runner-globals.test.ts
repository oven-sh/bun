import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A helper that is no test file uses `vi` without importing it: there the name only may be the runner's, and the build must still see what importMock() loads.
// In a larger project the fault doesn't show.
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "lib.js": `export function plain() { return "real"; }\n`,
  "helper.js": `export const load = () => vi.importMock("./lib.js");\n`,
  "m.test.js": `import { test } from "bun:test";
import { load } from "./helper.js";
test("t", async () => {
  const mocked = await load();
  console.log("SEEN", typeof mocked.plain, mocked.plain());
});
`,
};

test.each([
  ["bun test", []],
  ["one program", ["--aot"]],
])(
  "the runner's names without an import: importMock in a helper: %s",
  async (_, flags) => {
    using dir = tempDir("aot-runner-globals", files);
    const { stdout, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    expect({ seen: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode }).toEqual({
      seen: ["SEEN function undefined"],
      exitCode: 0,
    });
  },
  240_000,
);
