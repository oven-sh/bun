import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `this` at the top of a file that is named an ES module (.mjs, .mts) is undefined, whatever else its text holds and whoever loads it.
// A .js goes by its text, as under `bun run`, whatever its package says: a package that is wrapped for every loader hands `this` to its wrapper. A .cjs is CommonJS in a package of modules too.
// Compiled code had two answers: undefined beside an `export` or `import.meta`, and `exports` (the file taken for CommonJS) where the text had neither.
// `bun run` says "object" in all of them: the answers are written down here, not taken from it.
const files: Record<string, string> = {
  "main.mjs": `console.log("entry alone", typeof this);
await import("./alone.mjs");
await import("./typed.mts");
await import("./beside-import-meta.mjs");
await import("./with-an-export.mjs");
await import("./tested.mjs");
await import("./in-an-arrow.mjs");
await import("module-package/alone.js");
console.log("by default", JSON.stringify((await import("module-package/through-this.cjs")).default));
await import("plain-package/alone.js");
await import("./names-exports.mjs");
await import("./alone.cjs");
`,
  "alone.mjs": `console.log("alone", typeof this);\n`,
  "typed.mts": `console.log("typed", typeof this);\n`,
  "beside-import-meta.mjs": `console.log("beside import.meta", typeof import.meta.url, typeof this);\n`,
  "with-an-export.mjs": `export {}; console.log("with an export", typeof this);\n`,
  "tested.mjs": `console.log("tested", this ? "something" : "nothing", this === undefined, (function () { return typeof this; })());\n`,
  "in-an-arrow.mjs": `const own = () => typeof this; console.log("in an arrow", own());\n`,
  "node_modules/module-package/package.json": `{"name":"module-package","type":"module"}`,
  "node_modules/module-package/alone.js": `console.log("a package of modules", typeof this);\n`,
  "node_modules/module-package/through-this.cjs": `this.length = 2; this[0] = "stored through this"; console.log("commonjs by name in a package of modules", typeof this);\n`,
  "node_modules/plain-package/package.json": `{"name":"plain-package"}`,
  "node_modules/plain-package/alone.js": `console.log("a package that says nothing", typeof this);\n`,
  "names-exports.mjs": `exports.a = 1; console.log("names exports", typeof this, this === exports);\n`,
  "alone.cjs": `console.log("commonjs by name", typeof this, this === exports);\n`,
};

const said = `entry alone undefined
alone undefined
typed undefined
beside import.meta string undefined
with an export undefined
tested nothing true undefined
in an arrow undefined
a package of modules object
commonjs by name in a package of modules object
by default {"0":"stored through this","length":2}
a package that says nothing object
names exports object true
commonjs by name object true
`;

test("this at the top of a file that is declared an ES module is undefined", async () => {
  using dir = tempDir("aot-this-of-an-es-module", files);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "main"],
    String(dir),
    bunEnv,
  );
  expect(built.stderr).not.toContain("error");
  expect(built.exitCode).toBe(0);
  const ran = await run([join(String(dir), "main")], String(dir), bunEnv);
  expect(ran.stdout).toBe(said);
  expect(ran.exitCode).toBe(0);
});
