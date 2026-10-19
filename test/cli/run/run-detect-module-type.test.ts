import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// module type -> file extensions -> expected module type
const table = {
  cjs: {
    "hello.cjs": "commonjs",
    "hello.js": "commonjs",
    "hello.mjs": "module",
    "hello.ts": "commonjs",
    "hello.tsx": "module",
    "hello.cts": "commonjs",
    "hello.jsx": "module",
    "hello.mts": "module",
    // files using ES import and no exports will be detected as module
    "import.cjs": "module",
  },
  esm: {
    "hello.cjs": "commonjs",
    "hello.js": "module",
    "hello.mjs": "module",
    "hello.ts": "module",
    "hello.tsx": "module",
    "hello.cts": "commonjs",
    "hello.jsx": "module",
    "hello.mts": "module",
    // files using ES import and no exports will be detected as module
    "import.cjs": "module",
  },
};

describe("detect module type from the extension and package.json", () => {
  for (const [moduleType, extensions] of Object.entries(table)) {
    for (const [extension, expected] of Object.entries(extensions)) {
      test.concurrent(`${moduleType} ${extension} -> ${expected}`, async () => {
        const dir = join(import.meta.dir, "module-type-fixture", moduleType);
        const { stdout, stderr, exitCode } = await run(dir, "run", join(dir, extension));
        expect(stderr).toBe("");
        expect(stdout === "false" ? "commonjs" : "module").toBe(expected);
        expect(exitCode).toBe(0);
      });
    }
  }
});

// A `.mjs` file, or a `.js` file under `"type": "module"`, is an ES module.
// Node never binds `module` or `exports` there: a read gives `undefined`, an
// assignment throws. The parser must not turn the file into CommonJS because
// the source mentions one of those names (oven-sh/bun#45729).
describe("an ES module file never binds module or exports", () => {
  const typeofs = `console.log(typeof module, typeof exports, typeof require, typeof __dirname);`;
  const files = {
    "package.json": `{ "name": "app" }`,
    "typeof.mjs": typeofs,
    "typeof.mts": typeofs,
    "import-typeof.mjs": `import { sep } from "node:path";\nconsole.log(typeof module, typeof sep);`,
    "umd.mjs": `if (typeof module < "u" && module.exports) console.log("cjs"); else console.log("esm");`,
    "assign-module.mjs": `module.exports = 1;`,
    "assign-exports.mjs": `exports.x = 1;`,
    "main.mjs": `console.log(require.main === module);`,
    "typemod/package.json": `{ "type": "module" }`,
    "typemod/typeof.js": typeofs,
    "typemod/typeof.ts": typeofs,
    "typemod/import-typeof.js": `import { sep } from "node:path";\nconsole.log(typeof module, typeof sep);`,
    "typemod/assign-module.js": `module.exports = 1;`,
    "typemod/cjs.cjs": `module.exports = { fromCjs: true };`,
    // A dual package: the named package.json says "module", the CommonJS
    // build carries a nameless package.json that says "commonjs". Node reads
    // the nearest one.
    "dual/package.json": `{ "name": "dual", "type": "module" }`,
    "dual/cjs/package.json": `{ "type": "commonjs" }`,
    "dual/cjs/lib.js": `module.exports = { dual: typeof module };`,
    "dual/esm/lib.js": `export const dual = typeof module;`,
    "dual.cjs": `
      console.log(require("./dual/cjs/lib.js").dual);
      import("./dual/esm/lib.js").then(m => console.log(m.dual));
    `,
    // Files loaded by a static import transpile on the work pool, not on
    // the JS thread. Both paths must agree on the module type.
    "entry.mjs": `
      import "./typeof.mjs";
      import "./import-typeof.mjs";
      import "./umd.mjs";
      import "./typemod/typeof.js";
      import "./typemod/import-typeof.js";
      import cjs from "./typemod/cjs.cjs";
      import dualCjs from "./dual/cjs/lib.js";
      import { dual as dualEsm } from "./dual/esm/lib.js";
      console.log(JSON.stringify(cjs), dualCjs.dual, dualEsm);
    `,
    "dynamic.mjs": `
      await import("./typeof.mjs");
      console.log(JSON.stringify(await import("./typemod/cjs.cjs").then(m => m.default)));
      try { await import("./assign-module.mjs"); } catch (e) { console.log(e.name, e.message); }
    `,
    "require.cjs": `
      require("./typeof.mjs");
      try { require("./assign-exports.mjs"); } catch (e) { console.log(e.name, e.message); }
    `,
  };

  const cases: [string, string][] = [
    ["typeof.mjs", "undefined undefined function string"],
    ["typeof.mts", "undefined undefined function string"],
    ["import-typeof.mjs", "undefined string"],
    ["umd.mjs", "esm"],
    ["main.mjs", "true"],
    ["typemod/typeof.js", "undefined undefined function string"],
    ["typemod/typeof.ts", "undefined undefined function string"],
    ["typemod/import-typeof.js", "undefined string"],
    [
      "entry.mjs",
      [
        "undefined undefined function string",
        "undefined string",
        "esm",
        "undefined undefined function string",
        "undefined string",
        '{"fromCjs":true} object undefined',
      ].join("\n"),
    ],
    ["dual.cjs", "object\nundefined"],
    [
      "dynamic.mjs",
      ["undefined undefined function string", '{"fromCjs":true}', "ReferenceError module is not defined"].join("\n"),
    ],
    ["require.cjs", ["undefined undefined function string", "ReferenceError exports is not defined"].join("\n")],
  ];

  for (const [file, expected] of cases) {
    test.concurrent(file, async () => {
      using dir = tempDir("esm-module-type", files);
      const { stdout, stderr, exitCode } = await run(String(dir), file);
      expect(stdout).toBe(expected);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  }

  for (const [file, name] of [
    ["assign-module.mjs", "module"],
    ["assign-exports.mjs", "exports"],
    ["typemod/assign-module.js", "module"],
  ]) {
    test.concurrent(`${file} throws ReferenceError`, async () => {
      using dir = tempDir("esm-module-type", files);
      const { stdout, stderr, exitCode } = await run(String(dir), file);
      expect(stdout).toBe("");
      expect(stderr).toContain(`ReferenceError: ${name} is not defined`);
      expect(exitCode).toBe(1);
    });
  }
});

// A `.js` file with no `"type"` decides its module type from its contents.
// An `import` next to `module.exports` stays an error there.
test.concurrent("a .js file with no type field still rejects import next to module.exports", async () => {
  using dir = tempDir("unknown-module-type", {
    "dep.js": `export const x = 1;`,
    "mixed.js": `import { x } from "./dep.js";\nmodule.exports = { x };`,
    "typeof.js": `console.log(typeof module, typeof exports);`,
  });
  const mixed = await run(String(dir), "mixed.js");
  expect(mixed.stderr).toContain("Cannot use import statement with CommonJS-only features");
  expect(mixed.exitCode).toBe(1);

  const typeofs = await run(String(dir), "typeof.js");
  expect(typeofs.stdout).toBe("object object");
  expect(typeofs.exitCode).toBe(0);
});
