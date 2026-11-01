import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(300_000);

// For each case: t1 runs lib.js as what index.js imports. t2 imports lib.js by a statement, and what else it imports is the case. t3 resets the modules.
// t4 gets fresh instances of both: the counter in lib.js starts anew, and index.js counts on the same one.
const cases: Record<string, { imports?: string; extra?: string }> = {
  "a-requires-es-module": { imports: "extra.cjs", extra: "esm.mjs" },
  "b-requires-commonjs": { imports: "extra.cjs", extra: "other.cjs" },
  "c-imports-es-module": { imports: "esm.mjs" },
  "d-nothing-else": {},
};
const filesOf = (name: string, { imports, extra }: (typeof cases)[string]) => ({
  [`${name}-lib.js`]: `console.log("OUT ${name} lib runs"); let n = 0; export const bump = () => ++n;`,
  [`${name}-index.js`]: `import { bump } from "./${name}-lib.js"; console.log("OUT ${name} index runs"); export const viaIndex = () => bump();`,
  [`${name}-esm.mjs`]: `export default 1;`,
  [`${name}-other.cjs`]: `module.exports = 1;`,
  [`${name}-extra.cjs`]: extra ? `exports.k = require("./${name}-${extra}");` : "",
  [`${name}-t1.test.js`]: `import { test } from "bun:test";
import { viaIndex } from "./${name}-index.js";
test("t1", () => console.log("OUT ${name} t1", viaIndex()));`,
  [`${name}-t2.test.js`]: `import { test } from "bun:test";
${imports ? `import "./${name}-${imports}";` : ""}
import { bump } from "./${name}-lib.js";
test("t2", () => console.log("OUT ${name} t2", bump()));`,
  [`${name}-t3.test.js`]: `import { test, vi } from "bun:test";
test("t3", () => { vi.resetModules(); });`,
  [`${name}-t4.test.js`]: `import { test } from "bun:test";
import { viaIndex } from "./${name}-index.js";
import { bump } from "./${name}-lib.js";
test("t4", () => console.log("OUT ${name} t4", viaIndex(), bump()));`,
});

test("behind vi.resetModules() the next test file gets every module anew, whatever an earlier test file imported beside them", async () => {
  using dir = tempDir("aot-reset-after-require-esm", {
    "package.json": `{ "name": "p", "type": "module" }`,
    ...Object.assign({}, ...Object.entries(cases).map(([name, files]) => filesOf(name, files))),
  });
  const said = async (flags: string[], words = "") => {
    const { stdout, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    return { lines: stdout.split("\n").filter(line => line.startsWith("OUT ")), exitCode };
  };
  const plain = await said([]);
  expect(plain).toEqual({
    lines: Object.keys(cases).flatMap(name =>
      ["lib runs", "index runs", "t1 1", "t2 2", "lib runs", "index runs", "t4 1 2"].map(line => `OUT ${name} ${line}`),
    ),
    exitCode: 0,
  });
  expect(await Promise.all([said(["--aot"], "TestRunLayers:0"), said(["--aot"], "TestRunLayers:2")])).toEqual([
    plain,
    plain,
  ]);
});
