import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

// `import "./mod.mjs?two"`. A specifier with a query names a module of its own: the file is evaluated again, with its own
// variables, functions and classes, while the modules it imports are shared with the first.
// The build refuses it: "TS100159: bun compile does not support a query string in an import path". In `require()` and `import()`
// that is a warning, and the module is not found when the program runs.

const files = {
  "dep.mjs": `export const shared = { n: 0 };
console.log("dep.mjs is evaluated");
`,
  "mod.mjs": `import { shared } from "./dep.mjs";
let n = 0;
export function bump() { return ++n; }
export function bumpShared() { return ++shared.n; }
export class Thing {}
console.log("mod.mjs is evaluated");
`,
  "modc.cjs": `let n = 0;
exports.bump = function () { return ++n; };
console.log("modc.cjs is evaluated");
`,
  "meta.mjs": `const tail = text => String(text).replace(process.cwd(), "<cwd>").replace("/private<cwd>", "<cwd>");
export const meta = ["url", "path", "filename", "file", "dir", "dirname", "main"].map(name => name + "=" + tail(import.meta[name])).join(" ");
export const written = [import.meta.url, import.meta.path, import.meta.filename, import.meta.file, import.meta.dir, import.meta.dirname].map(tail).join(" ");
`,
  "metac.cjs": `const tail = text => String(text).replace(process.cwd(), "<cwd>").replace("/private<cwd>", "<cwd>");
exports.meta = [__filename, __dirname, module.id, module.filename, module.path, Object.keys(require.cache).filter(key => key.includes("metac")).join()].map(tail).join(" ");
`,
  "helper.mjs": `export { bump as other } from "./mod.mjs?q";
`,
  "node_modules/pkgq/package.json": `{ "name": "pkgq", "version": "1.0.0", "main": "index.js", "type": "module" }`,
  "node_modules/pkgq/index.js": `export const v = { n: 1 };
console.log("pkgq is evaluated");
`,
};

const programs: Record<string, string> = {
  "static-import.mjs": `import { bump, bumpShared, Thing } from "./mod.mjs";
import { bump as other, bumpShared as otherShared, Thing as OtherThing } from "./mod.mjs?two";
console.log(bump(), bump(), other(), other === bump, bumpShared(), otherShared(), new Thing() instanceof OtherThing);
`,
  "import-call.mjs": `import { bump } from "./mod.mjs";
const again = await import("./mod.mjs?one");
const third = await import("./mod.mjs?one");
console.log(bump(), bump(), again.bump(), again.bump === bump, third === again);
`,
  "require.cjs": `const a = require("./modc.cjs");
const b = require("./modc.cjs?x");
console.log(a.bump(), a.bump(), b.bump(), a === b, b === require("./modc.cjs?x"));
`,
  "only-with-a-query.mjs": `import { bump } from "./mod.mjs?only";
console.log(bump());
`,
  "empty-query.mjs": `import { bump } from "./mod.mjs";
import { bump as other } from "./mod.mjs?";
console.log(bump(), bump(), other(), other === bump);
`,
  "two-files-one-query.mjs": `import { bump } from "./mod.mjs?q";
import { other } from "./helper.mjs";
console.log(bump(), other(), other === bump);
`,
  "package.mjs": `import { v } from "pkgq";
import { v as w } from "pkgq?x";
console.log(v === w, v.n, w.n);
`,
  "import-meta.mjs": `import { meta, written } from "./meta.mjs";
import { meta as metaOfCopy, written as writtenInCopy } from "./meta.mjs?a=1&b=2";
console.log(meta); console.log(metaOfCopy); console.log(written); console.log(writtenInCopy);
`,
  "module-object.cjs": `console.log(require("./metac.cjs").meta); console.log(require("./metac.cjs?a=1&b=2").meta);
`,
  "typescript.ts": `import { bump } from "./mod.mjs";
// @ts-ignore
import { bump as other } from "./mod.mjs?two";
console.log(bump(), bump(), other(), other === bump);
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test.todo("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("specifiers-with-query", {
      ...files,
      [entry]: programs[entry],
      "tsconfig.json": `{ "compilerOptions": { "module": "preserve", "moduleResolution": "bundler", "allowJs": true, "types": [] } }`,
    });
    const plain = await spawned([bunExe(), "run", entry], String(dir));
    expect(plain.exitCode).toBe(0);
    const aot = await spawned([bunExe(), "run", "--debug-aot", entry], String(dir), {
      ...bunEnv,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
