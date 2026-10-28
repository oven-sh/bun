import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const here = process.platform;

function large(name: string) {
  const lines = [`function ${name}(text) {`, `  var x = text.length | 0;`];
  for (let i = 0; i < 2000; i++)
    lines.push(`  x = (x * ${i + 3} + text.length + ${i * 7 + 1}) % 1000003; if (x === ${i + 5}) console.log(x);`);
  lines.push(`  return x;`, `}`);
  return lines.join("\n") + "\n";
}

const files = {
  "cjs/modern.cjs": `"use strict";\nglobalThis.order = (globalThis.order ?? "") + " modern";\nexports.version = "1";\nexports.render = function (text) { return text.length; };\n`,
  "cjs/legacy.cjs": `"use strict";\nglobalThis.order = (globalThis.order ?? "") + " legacy";\n${large("renderAll")}exports.version = "1";\nexports.renderAll = renderAll;\n`,
  "main.mjs": `import Server from "./server.cjs";\nconsole.log(Server.render("abc"), globalThis.order);\n`,
};

const exported = `exports.version = modern.version;\nexports.render = modern.render;\nexports.renderAll = legacy.renderAll;\n`;
const stores = `  modern = require("./cjs/modern.cjs");\n  legacy = require("./cjs/legacy.cjs");\n`;

const servers: Record<string, string> = {
  "initialized": `"use strict";\nvar modern = require("./cjs/modern.cjs");\nvar legacy = require("./cjs/legacy.cjs");\n${exported}`,
  "stored-to-in-the-side-of-an-if-that-the-build-takes": `"use strict";\nvar modern;\nvar legacy;\nif (process.platform === "${here}") {\n${stores}} else {\n${stores}}\n${exported}`,
  "stored-to-at-the-top": `"use strict";\nvar modern, legacy;\n${stores}${exported}`,
};

const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

test("a function that only an export nobody reads leads to is left out, however the variable came by the module", async () => {
  const sizes: Record<string, number> = {};
  for (const name of Object.keys(servers)) {
    using dir = tempDir("stored-to-once", { ...files, "server.cjs": servers[name] });
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "program"],
      String(dir),
      bunEnv,
    );
    expect({ name, stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      name,
      stderr: expect.any(String),
      exitCode: 0,
    });
    const compiled = await run([join(String(dir), "program")], String(dir), env);
    expect({ name, stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      name,
      stdout: "3  modern legacy\n",
      exitCode: 0,
    });
    sizes[name] = statSync(join(String(dir), isWindows ? "program.exe" : "program")).size;
  }
  for (const name of Object.keys(servers)) {
    expect({ name, grows: sizes[name] - sizes["initialized"] > 64 * 1024 }).toEqual({ name, grows: false });
  }
}, 180_000);

const small = {
  "lib.cjs": `exports.name = "lib";\nexports.count = 0;\nexports.next = function () { return ++exports.count; };\n`,
  "other.cjs": `exports.name = "other";\n`,
};

const programs: Record<string, string> = {
  "read-ahead-of-the-store.cjs": `var lib;
try {
  console.log(lib.name);
} catch (error) {
  console.log(error.name);
}
lib = require("./lib.cjs");
console.log(lib.name);
`,
  "read-by-a-function-that-is-called-ahead-of-the-store.cjs": `var lib;
function name() {
  return lib.name;
}
try {
  console.log(name());
} catch (error) {
  console.log(error.name);
}
lib = require("./lib.cjs");
console.log(name(), lib.next(), lib.next(), lib.count);
`,
  "stored-to-twice.cjs": `var lib;
lib = require("./lib.cjs");
console.log(lib.name);
lib = require("./other.cjs");
console.log(lib.name);
`,
  "stored-to-in-a-side-that-is-decided-when-the-program-runs.cjs": `var lib;
if (process.argv.length > 100) {
  lib = require("./other.cjs");
} else {
  lib = require("./lib.cjs");
}
console.log(lib.name);
`,
  "stored-to-by-a-function.cjs": `var lib;
function load() {
  lib = require("./lib.cjs");
}
console.log(typeof lib);
load();
console.log(lib.name);
`,
  "the-value-of-the-store-is-used.cjs": `var lib, same;
same = lib = require("./lib.cjs");
console.log(same === lib, same.name, Object.keys(same).join());
`,
  "the-variable-is-handed-on.cjs": `var lib;
lib = require("./lib.cjs");
console.log(Object.keys(lib).join(), lib === require("./lib.cjs"));
`,
  "declared-by-let.cjs": `let lib;
const name = () => lib.name;
try {
  console.log(name());
} catch (error) {
  console.log(error.name);
}
lib = require("./lib.cjs");
console.log(name());
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("prints what bun run prints, under bun run --aot and as an executable", async () => {
    using dir = tempDir("stored-to-once", { ...small, [entry]: programs[entry] });
    const plain = await run([bunExe(), "run", entry], String(dir), bunEnv);
    expect(plain.exitCode).toBe(0);
    const inPlace = await run([bunExe(), "run", "--debug-aot", entry], String(dir), env);
    expect(inPlace.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: inPlace.stdout, exitCode: inPlace.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", entry, "--outfile", "program"],
      String(dir),
      bunEnv,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    const compiled = await run([join(String(dir), "program")], String(dir), env);
    expect(compiled.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
