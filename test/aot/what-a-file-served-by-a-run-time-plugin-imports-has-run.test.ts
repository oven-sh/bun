import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A plugin that is registered while a test runs matches a file, or one import of a file: from then on the text of that file runs from disk, and of whatever imports it.
// That text asks the loader for its other imports, which are compiled. Where one compiled importer alone started such a module, its body was called from the importer's
// code and the module had none for the loader to call: "Cannot access 'x' before initialization".
const shared = {
  "package.json": `{ "type": "module" }`,
  "k.js": `console.log("k runs"); export const x = "real"; export let count = 1; export function f() { return "f"; }`,
  "slow.js": `console.log("slow runs"); export const s = "slow";`,
  "user.js": `console.log("user runs"); import { x, count, f } from "./k.js"; import { s } from "./slow.js"; export const seen = [x, count, f(), s].join("/");`,
  "mid.js": `import { x } from "./k.js"; import "./slow.js"; export { x };`,
  "above.js": `import { x } from "./mid.js"; export const seen = x + "/1/f/slow";`,
};
const testFile = (filter: string, imported: string) => `
  import { expect, test } from "bun:test";
  test("t", async () => {
    Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: ${filter} }, () => undefined); } });
    expect((await import("./${imported}")).seen).toBe("real/1/f/slow");
  });`;

async function runTests(folder: string, flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], folder, {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return { printed: stdout.replace(/^bun test .*\n/, ""), counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode };
}

test.each([
  ["one import of the file", "/slow\\.js$/", "user.js"],
  ["the file itself", "/user\\.js$/", "user.js"],
  ["an import two files below", "/slow\\.js$/", "above.js"],
])(
  "the plugin matches %s",
  async (_, filter, imported) => {
    using dir = tempDir("served-by-a-run-time-plugin", { ...shared, "x.test.js": testFile(filter, imported) });
    const plain = await runTests(String(dir), []);
    expect(plain).toMatchObject({ counts: [" 1 pass", " 0 fail"], exitCode: 0 });
    expect(await runTests(String(dir), ["--aot"])).toEqual(plain);
  },
  240_000,
);
