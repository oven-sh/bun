import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("run-cjs", () => {
  test("running a commonjs module works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "index1.js"), "module.exports = 1; console.log('hello world');");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "index1.js")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });
});

describe.concurrent("module type from .mjs / package.json is authoritative over module/exports references", () => {
  const guardBody = `import path from "node:path";
console.log(JSON.stringify({ m: typeof module, e: typeof exports, sep: typeof path.sep }));
`;
  const bareBody = `console.log(JSON.stringify({ m: typeof module, e: typeof exports, thisIsCjs: typeof this === "object" && this != null }));
`;

  async function run(cwd: string, entry: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr only appears in the assertion diff when stdout is empty (crash/parse error).
    const out = stdout.trim()
      ? stdout
          .trim()
          .split("\n")
          .map(l => JSON.parse(l))
      : [{ crashed: stderr }];
    return { out, exitCode };
  }

  const esmGuard = { m: "undefined", e: "undefined", sep: "string" };
  const esmBare = { m: "undefined", e: "undefined", thisIsCjs: false };
  const cjsBare = { m: "object", e: "object", thisIsCjs: true };

  test(".mjs with import + typeof module runs as ESM", async () => {
    using dir = tempDir("mjs-guard", { "guard.mjs": guardBody });
    expect(await run(String(dir), "guard.mjs")).toEqual({ out: [esmGuard], exitCode: 0 });
  });

  test(".mts with import + typeof module runs as ESM", async () => {
    using dir = tempDir("mts-guard", { "guard.mts": guardBody });
    expect(await run(String(dir), "guard.mts")).toEqual({ out: [esmGuard], exitCode: 0 });
  });

  test('"type":"module" .js with import + typeof module runs as ESM', async () => {
    using dir = tempDir("tm-guard", {
      "package.json": `{"type":"module"}`,
      "guard.js": guardBody,
    });
    expect(await run(String(dir), "guard.js")).toEqual({ out: [esmGuard], exitCode: 0 });
  });

  test(".mjs with no import/export + typeof exports runs as ESM", async () => {
    using dir = tempDir("mjs-bare", { "bare.mjs": bareBody });
    expect(await run(String(dir), "bare.mjs")).toEqual({ out: [esmBare], exitCode: 0 });
  });

  test('"type":"module" .js with no import/export + typeof module runs as ESM', async () => {
    using dir = tempDir("tm-bare", {
      "package.json": `{"type":"module"}`,
      "bare.js": bareBody,
    });
    expect(await run(String(dir), "bare.js")).toEqual({ out: [esmBare], exitCode: 0 });
  });

  test(".mjs loaded via dynamic import() runs as ESM", async () => {
    using dir = tempDir("mjs-dyn", {
      "guard.mjs": guardBody,
      "bare.mjs": bareBody,
      "entry.mjs": `await import("./guard.mjs");\nawait import("./bare.mjs");\n`,
    });
    expect(await run(String(dir), "entry.mjs")).toEqual({ out: [esmGuard, esmBare], exitCode: 0 });
  });

  test('.mjs inside "type":"commonjs" package still runs as ESM (extension wins)', async () => {
    using dir = tempDir("mjs-in-cjs", {
      "package.json": `{"type":"commonjs"}`,
      "guard.mjs": guardBody,
      "entry.js": `import("./guard.mjs");\n`,
    });
    expect(await run(String(dir), "entry.js")).toEqual({ out: [esmGuard], exitCode: 0 });
  });

  test('.js under node_modules with no package.json does not inherit outer "type":"module"', async () => {
    using dir = tempDir("nm-no-pkg", {
      "package.json": `{"name":"proj","type":"module"}`,
      "node_modules/foo/index.js": `module.exports = { m: typeof module, e: typeof exports, thisIsCjs: true };\n`,
      "entry.mjs": `import x from "foo"; console.log(JSON.stringify(x));\n`,
    });
    expect(await run(String(dir), "entry.mjs")).toEqual({ out: [cjsBare], exitCode: 0 });
  });

  test('nameless nested {"type":"commonjs"} overrides an outer {"type":"module"}', async () => {
    using dir = tempDir("nested-cjs", {
      "package.json": `{"name":"outer","type":"module"}`,
      "dist/cjs/package.json": `{"type":"commonjs"}`,
      "dist/cjs/inner/index.js": `Object.defineProperty(exports, "ok", { value: true });\n` + bareBody,
      "entry.mjs": `await import("./dist/cjs/inner/index.js");\n`,
    });
    expect(await run(String(dir), "entry.mjs")).toEqual({ out: [cjsBare], exitCode: 0 });
  });

  test('.cjs inside "type":"module" package still runs as CJS (extension wins)', async () => {
    using dir = tempDir("cjs-in-esm", {
      "package.json": `{"type":"module"}`,
      "mod.cjs": bareBody,
      "entry.mjs": `await import("./mod.cjs");\n`,
    });
    expect(await run(String(dir), "entry.mjs")).toEqual({ out: [cjsBare], exitCode: 0 });
  });

  test("ambiguous .js with typeof module still runs as CJS", async () => {
    using dir = tempDir("js-sniff", { "sniff.js": bareBody });
    expect(await run(String(dir), "sniff.js")).toEqual({ out: [cjsBare], exitCode: 0 });
  });

  test(".cjs with typeof module still runs as CJS", async () => {
    using dir = tempDir("cjs-sniff", { "sniff.cjs": bareBody });
    expect(await run(String(dir), "sniff.cjs")).toEqual({ out: [cjsBare], exitCode: 0 });
  });
});
