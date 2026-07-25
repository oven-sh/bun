import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Node.js routes every CJS-loader load (the entrypoint, a CJS module reached
// from ESM import, and nested require()) through Module._extensions, so a
// `-r` preload hook like babel-register or pirates sees all of them.
describe.concurrent("Module._extensions fires for the CJS entrypoint and CJS reached via ESM import", () => {
  const hook = `
const M = require("module"), path = require("path"), oe = M._extensions[".js"];
globalThis.__hits = [];
M._extensions[".js"] = function (m, f) { globalThis.__hits.push(path.basename(f)); return oe(m, f); };
`;

  test("CJS entrypoint and nested require hit the overridden .js handler", async () => {
    using dir = tempDir("ext-entry", {
      "package.json": '{"type":"commonjs"}',
      "hook.cjs": hook,
      "dep.js": "module.exports = 1;",
      "dep2.cjs": "module.exports = 2;",
      "main.js": 'require("./dep.js"); require("./dep2.cjs"); console.log(JSON.stringify(globalThis.__hits));',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // Node's findLongestRegisteredExtension falls back to ".js" for .cjs.
    expect(stdout.trim()).toBe('["main.js","dep.js","dep2.cjs"]');
    expect(exitCode).toBe(0);
  });

  test(".cjs entrypoint falls back to the overridden .js handler", async () => {
    using dir = tempDir("ext-entry-cjs", {
      "package.json": '{"type":"commonjs"}',
      "hook.cjs": hook,
      "dep.js": "module.exports = 1;",
      "main.cjs": 'require("./dep.js"); console.log(JSON.stringify(globalThis.__hits));',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe('["main.cjs","dep.js"]');
    expect(exitCode).toBe(0);
  });

  test("ESM import of a CJS module hits the overridden .js handler", async () => {
    using dir = tempDir("ext-esm-import", {
      "package.json": '{"type":"commonjs"}',
      "hook.cjs": hook,
      "dep.js": "module.exports = 1;",
      "dep2.cjs": "module.exports = 2;",
      "main.mjs": 'await import("./dep.js"); await import("./dep2.cjs"); console.log(JSON.stringify(globalThis.__hits));',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe('["dep.js","dep2.cjs"]');
    expect(exitCode).toBe(0);
  });

  test("ESM import of an ESM .js module does NOT hit the overridden .js handler", async () => {
    using dir = tempDir("ext-esm-esm", {
      "package.json": '{"type":"module"}',
      "hook.cjs": hook,
      "dep.js": "export const x = 1;",
      "main.js": 'import "./dep.js"; console.log(JSON.stringify(globalThis.__hits));',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("[]");
    expect(exitCode).toBe(0);
  });

  test("ESM import of an auto-detected ESM .js (no package.json type) still works with a passthrough .js override", async () => {
    using dir = tempDir("ext-nopkg-esm", {
      "hook.cjs": `
const M = require("module"), oe = M._extensions[".js"];
M._extensions[".js"] = (m, f) => oe(m, f);
`,
      "foo.js": "export const x = 42;",
      "main.mjs": 'import { x } from "./foo.js"; console.log("x=" + x);',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("x=42");
    expect(exitCode).toBe(0);
  });

  test("require() of a sibling CJS module already fetched (but not yet evaluated) by the ESM loader runs its extension handler", async () => {
    using dir = tempDir("ext-cross-require", {
      "package.json": '{"type":"commonjs"}',
      "hook.cjs": `
const M = require("module"), fs = require("fs");
M._extensions[".js"] = (m, f) => m._compile(fs.readFileSync(f, "utf8"), f);
`,
      "a.js": 'module.exports = { fromB: require("./b.js").value };',
      "b.js": "module.exports = { value: 42 };",
      "main.mjs": 'import a from "./a.js"; import "./b.js"; console.log(JSON.stringify({ fromB: a.fromB }));',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe('{"fromB":42}');
    expect(exitCode).toBe(0);
  });

  test("a preload hook that transforms source applies to the CJS entrypoint and CJS via ESM import", async () => {
    using dir = tempDir("ext-transform", {
      "package.json": '{"type":"commonjs"}',
      "hook.cjs": `
const M = require("module"), fs = require("fs");
M._extensions[".js"] = function (m, f) {
  m._compile(fs.readFileSync(f, "utf8").replace(/REPLACE_ME/g, '"xform"'), f);
};
`,
      "dep.js": 'module.exports = { value: REPLACE_ME, nested: require("./dep2.js") };',
      "dep2.js": 'module.exports = REPLACE_ME + "2";',
      "main.js": 'console.log(JSON.stringify({ entry: REPLACE_ME, nested: require("./dep2.js") }));',
      "main.mjs": 'import dep from "./dep.js"; console.log(JSON.stringify(dep));',
    });
    await using p1 = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [out1, err1, code1] = await Promise.all([p1.stdout.text(), p1.stderr.text(), p1.exited]);
    expect(err1).toBe("");
    expect(out1.trim()).toBe('{"entry":"xform","nested":"xform2"}');
    expect(code1).toBe(0);

    await using p2 = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [out2, err2, code2] = await Promise.all([p2.stdout.text(), p2.stderr.text(), p2.exited]);
    expect(err2).toBe("");
    expect(out2.trim()).toBe('{"value":"xform","nested":"xform2"}');
    expect(code2).toBe(0);
  });
});
