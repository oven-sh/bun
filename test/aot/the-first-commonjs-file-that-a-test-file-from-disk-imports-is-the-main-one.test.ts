import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const about = `exports.about = () => [module.id === __filename ? "its path" : module.id, String(module.parent && "a module")];\n`;

test("the one CommonJS file that a test file imports by a statement has the id and the parent of the main module", async () => {
  using dir = tempDir("aot-first-commonjs-file-of-a-test-file-from-disk", {
    "package.json": `{ "name": "first-commonjs-file-of-a-test-file-from-disk" }`,
    "src/imported.cjs": about,
    "src/required.cjs": about,
    "a.test.js": `
import { test } from "bun:test";
import { createRequire } from "node:module";
import * as imported from "./src/imported.cjs";
test("ids and parents", () => {
  const required = createRequire(import.meta.url)("./src/required.cjs");
  console.error("SEEN " + JSON.stringify([imported.about(), required.about()]));
});
`,
  });
  const seenWith = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
    return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [plain, compiled, fromDisk] = await Promise.all([
    seenWith({}),
    seenWith({}, "--aot"),
    seenWith({ BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" }, "--aot"),
  ]);
  expect(plain.seen).toEqual([`SEEN [[".","null"],["its path","a module"]]`]);
  expect(compiled).toEqual(plain);
  expect(fromDisk).toEqual(plain);
});
