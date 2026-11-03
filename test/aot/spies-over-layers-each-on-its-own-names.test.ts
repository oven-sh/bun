import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A spy on an export needs two things over layers: the layer that DECLARES the export was told, before any test file was compiled, that a test replaces it,
// and the run time follows the chain of re-exports from the namespace that the test holds down into that layer.
// Each form here has a package and names of its own, and no file spies on an object that the build cannot name, so no form opens anything for another.
type Form = {
  barrel?: Record<string, string>;
  holds: string;
  name: string;
  packageFiles: Record<string, string>;
  reads: string;
};
const esm = (name: string, f: string) => ({
  [`node_modules/${name}/package.json`]: `{ "name": "${name}", "type": "module", "main": "index.js" }`,
  [`node_modules/${name}/index.js`]: `export function ${f}() { return "real ${f}"; }\nexport function calls_${f}() { return ${f}(); }\n`,
});
const forms: Record<string, Form> = {
  star: {
    packageFiles: esm("p1", "f1"),
    barrel: { "src/b1.ts": `export * from "p1";\n` },
    holds: `import * as held from "../src/b1";`,
    name: "f1",
    reads: `import { f1 as a } from "./b1"; import { f1 as b, calls_f1 as c } from "p1";`,
  },
  named: {
    packageFiles: esm("p2", "f2"),
    barrel: { "src/b2.ts": `export { f2 } from "p2";\n` },
    holds: `import * as held from "../src/b2";`,
    name: "f2",
    reads: `import { f2 as a } from "./b2"; import { f2 as b, calls_f2 as c } from "p2";`,
  },
  local: {
    packageFiles: esm("p3", "f3"),
    barrel: { "src/b3.ts": `import { f3 } from "p3";\nexport { f3 };\n` },
    holds: `import * as held from "../src/b3";`,
    name: "f3",
    reads: `import { f3 as a } from "./b3"; import { f3 as b, calls_f3 as c } from "p3";`,
  },
  barrels: {
    packageFiles: esm("p4", "f4"),
    barrel: { "src/b4.ts": `export * from "./b4-inner";\n`, "src/b4-inner.ts": `export * from "p4";\n` },
    holds: `import * as held from "../src/b4";`,
    name: "f4",
    reads: `import { f4 as a } from "./b4"; import { f4 as b, calls_f4 as c } from "p4";`,
  },
  commonjs: {
    packageFiles: {
      "node_modules/p5/package.json": `{ "name": "p5", "main": "index.js" }`,
      "node_modules/p5/index.js": `exports.f5 = function f5() { return "real f5"; };\nexports.calls_f5 = function () { return exports.f5(); };\n`,
    },
    holds: `import * as held from "p5";`,
    name: "f5",
    reads: `import { f5 as a } from "p5"; import whole from "p5"; const b = () => whole.f5(); import { calls_f5 as c } from "p5";`,
  },
  object: {
    packageFiles: {
      "node_modules/p6/package.json": `{ "name": "p6", "main": "index.js" }`,
      "node_modules/p6/index.js": `const api = { f6() { return "real f6"; }, calls_f6() { return api.f6(); } };\nmodule.exports = api;\n`,
    },
    holds: `import * as held from "p6";`,
    name: "f6",
    reads: `import * as all from "p6"; const a = () => all.f6(); import whole from "p6"; const b = () => whole.f6(); const c = () => whole.calls_f6();`,
  },
  library: {
    packageFiles: {},
    barrel: { "src/b7.js": `import { randomUUID } from 'crypto'\nexport { randomUUID }\n` },
    holds: `import * as held from "../src/b7.js";`,
    name: "randomUUID",
    reads: `import { randomUUID as x } from "./b7.js"; import { randomUUID as y } from "node:crypto"; const a = () => String(x()).length, b = () => String(y()).length, c = () => String(require("crypto").randomUUID()).length;`,
  },
};

const files: Record<string, string> = { "package.json": `{ "name": "p", "type": "module" }`, "tsconfig.json": `{}` };
for (const [form, { barrel, holds, name, packageFiles, reads }] of Object.entries(forms)) {
  Object.assign(files, packageFiles, barrel);
  files[`src/reads-${form}.js`] = `${reads}\nexport const seen = () => [a(), b(), c()];\n`;
  files[`test/${form}.test.js`] = `import { expect, spyOn, test } from "bun:test";
${holds}
import { seen } from "../src/reads-${form}.js";
test(${JSON.stringify(form)}, () => {
  const all = () => [String(held.${name}()).length > 30 ? 36 : held.${name}(), seen()];
  let said;
  try {
    const before = all();
    const spy = spyOn(held, ${JSON.stringify(name)}).mockImplementation(() => "spied");
    const during = all();
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    said = JSON.stringify([before, during, calls, all()]);
  } catch (error) {
    said = error.name + ": " + error.message.slice(0, 40);
  }
  console.log("SEEN ${form} | " + said);
  expect(1).toBe(1);
});
`;
}

async function seenIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-spies-over-layers", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags, "./test"], String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("SEEN "));
  return { seen: seen.sort(), exitCode };
}

test("a spy reaches the export through every kind of barrel, whichever layer declares it", async () => {
  const [plain, one, layers] = await Promise.all([
    seenIn(undefined),
    seenIn("TestRunLayers:0", "--aot"),
    seenIn("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain.seen.length).toBe(Object.keys(forms).length);
  expect(plain.seen.filter(line => line.includes("Error"))).toEqual([]);
  expect(plain.exitCode).toBe(0);
  expect(one).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);
