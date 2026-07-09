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
    return { stdout, stderr, exitCode };
  }

  test(".mjs with import + typeof module runs as ESM", async () => {
    using dir = tempDir("mjs-guard", { "guard.mjs": guardBody });
    const { stdout, stderr, exitCode } = await run(String(dir), "guard.mjs");
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      out: { m: "undefined", e: "undefined", sep: "string" },
      stderr: "",
      exitCode: 0,
    });
  });

  test(".mts with import + typeof module runs as ESM", async () => {
    using dir = tempDir("mts-guard", { "guard.mts": guardBody });
    const { stdout, stderr, exitCode } = await run(String(dir), "guard.mts");
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      out: { m: "undefined", e: "undefined", sep: "string" },
      stderr: "",
      exitCode: 0,
    });
  });

  test('"type":"module" .js with import + typeof module runs as ESM', async () => {
    using dir = tempDir("tm-guard", {
      "package.json": `{"type":"module"}`,
      "guard.js": guardBody,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "guard.js");
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      out: { m: "undefined", e: "undefined", sep: "string" },
      stderr: "",
      exitCode: 0,
    });
  });

  test(".mjs with no import/export + typeof exports runs as ESM", async () => {
    using dir = tempDir("mjs-bare", { "bare.mjs": bareBody });
    const { stdout, stderr, exitCode } = await run(String(dir), "bare.mjs");
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      out: { m: "undefined", e: "undefined", thisIsCjs: false },
      stderr: "",
      exitCode: 0,
    });
  });

  test('"type":"module" .js with no import/export + typeof module runs as ESM', async () => {
    using dir = tempDir("tm-bare", {
      "package.json": `{"type":"module"}`,
      "bare.js": bareBody,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "bare.js");
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      out: { m: "undefined", e: "undefined", thisIsCjs: false },
      stderr: "",
      exitCode: 0,
    });
  });

  test(".mjs loaded via dynamic import() runs as ESM", async () => {
    using dir = tempDir("mjs-dyn", {
      "guard.mjs": guardBody,
      "bare.mjs": bareBody,
      "entry.mjs": `await import("./guard.mjs");\nawait import("./bare.mjs");\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
    const lines = stdout.trim()
      ? stdout
          .trim()
          .split("\n")
          .map(l => JSON.parse(l))
      : [];
    expect({ lines, stderr, exitCode }).toEqual({
      lines: [
        { m: "undefined", e: "undefined", sep: "string" },
        { m: "undefined", e: "undefined", thisIsCjs: false },
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  test('.mjs inside "type":"commonjs" package still runs as ESM (extension wins)', async () => {
    using dir = tempDir("mjs-in-cjs", {
      "package.json": `{"type":"commonjs"}`,
      "guard.mjs": guardBody,
      "entry.js": `import("./guard.mjs");\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "entry.js");
    expect({ out: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      out: { m: "undefined", e: "undefined", sep: "string" },
      stderr: "",
      exitCode: 0,
    });
  });

  test('.cjs inside "type":"module" package still runs as CJS (extension wins)', async () => {
    using dir = tempDir("cjs-in-esm", {
      "package.json": `{"type":"module"}`,
      "mod.cjs": bareBody,
      "entry.mjs": `await import("./mod.cjs");\n`,
    });
    const { stdout, exitCode } = await run(String(dir), "entry.mjs");
    const out = JSON.parse(stdout);
    expect({ m: out.m, e: out.e, exitCode }).toEqual({ m: "object", e: "object", exitCode: 0 });
  });

  test("ambiguous .js with typeof module still runs as CJS", async () => {
    using dir = tempDir("js-sniff", { "sniff.js": bareBody });
    const { stdout, exitCode } = await run(String(dir), "sniff.js");
    const out = JSON.parse(stdout);
    expect({ m: out.m, e: out.e, exitCode }).toEqual({ m: "object", e: "object", exitCode: 0 });
  });

  test(".cjs with typeof module still runs as CJS", async () => {
    using dir = tempDir("cjs-sniff", { "sniff.cjs": bareBody });
    const { stdout, exitCode } = await run(String(dir), "sniff.cjs");
    const out = JSON.parse(stdout);
    expect({ m: out.m, e: out.e, exitCode }).toEqual({ m: "object", e: "object", exitCode: 0 });
  });
});
