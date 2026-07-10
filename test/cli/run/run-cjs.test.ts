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

describe.concurrent("explicit CommonJS module type rejects ESM-only syntax", () => {
  async function run(cwd: string, entry: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const exportBody = `export const x = 7;\nconsole.log("ran");\n`;
  const tlaBody = `await Promise.resolve();\nconsole.log("ran");\n`;

  test("export in .cjs is an error", async () => {
    using dir = tempDir("cjs-export", { "t.cjs": exportBody });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.cjs");
    expect(stderr).toContain("Cannot use 'export' in a CommonJS module");
    expect(stderr).toContain('This file is CommonJS because of its ".cjs" extension');
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test('export in .js under "type":"commonjs" is an error', async () => {
    using dir = tempDir("tc-export", {
      "package.json": `{"type":"commonjs"}`,
      "t.js": exportBody,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.js");
    expect(stderr).toContain("Cannot use 'export' in a CommonJS module");
    expect(stderr).toContain('the nearest package.json sets "type": "commonjs"');
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test("top-level await in .cjs is an error", async () => {
    using dir = tempDir("cjs-tla", { "t.cjs": tlaBody });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.cjs");
    expect(stderr).toContain("Cannot use top-level 'await' in a CommonJS module");
    expect(stderr).toContain('This file is CommonJS because of its ".cjs" extension');
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test('top-level await in .js under "type":"commonjs" is an error', async () => {
    using dir = tempDir("tc-tla", {
      "package.json": `{"type":"commonjs"}`,
      "t.js": tlaBody,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.js");
    expect(stderr).toContain("Cannot use top-level 'await' in a CommonJS module");
    expect(stderr).toContain('the nearest package.json sets "type": "commonjs"');
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test('.js under "type":"commonjs" with export rejects even when imported from .mjs', async () => {
    using dir = tempDir("tc-imported", {
      "pkg/package.json": `{"name":"p","type":"commonjs"}`,
      "pkg/t.js": exportBody,
      "p.mjs": `import { x } from "./pkg/t.js"; console.log("named", x);\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "p.mjs");
    expect(stderr).toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test(".cjs with export rejects when loaded via dynamic import()", async () => {
    using dir = tempDir("cjs-dyn", {
      "t.cjs": exportBody,
      "entry.mjs": `await import("./t.cjs");\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
    expect(stderr).toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test(".cjs with export rejects when loaded via require()", async () => {
    using dir = tempDir("cjs-req", {
      "t.cjs": exportBody,
      "entry.cjs": `require("./t.cjs");\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.cjs");
    expect(stderr).toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  // Negative controls: these must keep working.

  test("export in .mjs still runs as ESM", async () => {
    using dir = tempDir("mjs-export", { "t.mjs": exportBody });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.mjs");
    expect(stderr).not.toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });

  test('export in .js under "type":"module" still runs as ESM', async () => {
    using dir = tempDir("tm-export", {
      "package.json": `{"type":"module"}`,
      "t.js": exportBody,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.js");
    expect(stderr).not.toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });

  test("export in .js with no package.json type still runs (ambiguous: content decides)", async () => {
    using dir = tempDir("untyped-export", { "t.js": exportBody });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.js");
    expect(stderr).not.toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });

  test('.mjs inside "type":"commonjs" package still runs as ESM (extension wins)', async () => {
    using dir = tempDir("mjs-in-cjs", {
      "package.json": `{"type":"commonjs"}`,
      "t.mjs": exportBody,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.mjs");
    expect(stderr).not.toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });

  test('nameless nested {"type":"module"} overrides outer {"type":"commonjs"} (dual-package layout)', async () => {
    // e.g. puppeteer: root `{"type":"commonjs"}`, `lib/esm/package.json` = `{"type":"module"}`.
    using dir = tempDir("nested-esm", {
      "package.json": `{"name":"pkg","type":"commonjs"}`,
      "lib/esm/package.json": `{"type":"module"}`,
      "lib/esm/inner/t.js": exportBody,
      "entry.mjs": `await import("./lib/esm/inner/t.js");\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
    expect(stderr).not.toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });

  test('nameless nested {"type":"commonjs"} overrides outer {"type":"module"}', async () => {
    using dir = tempDir("nested-cjs", {
      "package.json": `{"name":"pkg","type":"module"}`,
      "dist/cjs/package.json": `{"type":"commonjs"}`,
      "dist/cjs/inner/t.js": exportBody,
      "entry.mjs": `await import("./dist/cjs/inner/t.js");\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
    expect(stderr).toContain("Cannot use 'export' in a CommonJS module");
    expect(stderr).toContain('the nearest package.json sets "type": "commonjs"');
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test("module.exports in .cjs still runs as CJS", async () => {
    using dir = tempDir("cjs-modexp", {
      "t.cjs": `module.exports = { x: 7 };\nconsole.log("ran");\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.cjs");
    expect(stderr).not.toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });

  // TypeScript is intentionally excluded: `export` in a CommonJS-typed .ts/.cts
  // is idiomatic (tsc compiles it to `exports.x = ...`).
  test("export in .cts is not an error (TypeScript excluded)", async () => {
    using dir = tempDir("cts-export", { "t.cts": exportBody });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.cts");
    expect(stderr).not.toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });

  test('export in .ts under "type":"commonjs" is not an error (TypeScript excluded)', async () => {
    using dir = tempDir("tc-export-ts", {
      "package.json": `{"type":"commonjs"}`,
      "t.ts": exportBody,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "t.ts");
    expect(stderr).not.toContain("Cannot use 'export' in a CommonJS module");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });

  test("Bun.build does not reject export in .cjs (bundler has its own format resolution)", async () => {
    using dir = tempDir("cjs-build", { "t.cjs": exportBody });
    const result = await Bun.build({ entrypoints: [join(String(dir), "t.cjs")], target: "bun" });
    expect(result.logs.filter(l => l.level === "error")).toEqual([]);
    expect(result.success).toBe(true);
  });
});
