import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// As jiti's loader hooks have it: a template that begins with a whole import whose path is a substitution. The build reads such a text as code, and the parser goes on
// without the name of the file.
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "node_modules/wraps/package.json": `{ "name": "wraps", "type": "module", "main": "index.js" }`,
  "node_modules/wraps/index.js": `export function wrap(source, path) {
  return \`import { make as __make__ } from \${JSON.stringify(path)};async function _module(exports) { \${source} }
const module = { exports: Object.create(null) };
await _module(module.exports);
export default module.exports;\`;
}
`,
  "own.js": `export const own = path => \`import { assert, should } from \${JSON.stringify(path)};assert.equal(1, 1);export default should;\`;\n`,
  "a.test.js": `import { test } from "bun:test";
import { wrap } from "wraps";
import { own } from "./own.js";
test("wraps", () => console.log("SEEN", wrap("1;", "./a.js").length, own("vitest").length));
`,
};

test.each([[["test"]], [["test", "--aot"]]])("bun %j", async command => {
  using dir = tempDir("aot-text-import-without-name", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), ...command], String(dir), bunEnv);
  const seen = (stdout + stderr).split("\n").filter(line => line.startsWith("SEEN"));
  expect({ seen, exitCode }).toEqual({ seen: ["SEEN 191 81"], exitCode: 0 });
});
