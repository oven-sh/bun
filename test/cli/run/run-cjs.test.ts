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

// The .cjs/.cts extension is unconditionally CommonJS in Node; `export`, `import`
// statements and top-level `await` are a SyntaxError there. Bun used to silently
// run such files as ES modules, so a package could ship a .cjs that passed Bun CI
// and was unloadable in Node.
describe.concurrent("ES module syntax in a .cjs/.cts file is an error", () => {
  async function run(files: Record<string, string>, entry: string) {
    using dir = tempDir("cjs-esm-syntax", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const cases: Array<[string, string, string, string]> = [
    ["export const", "bad.cjs", "export const x = 7;\n", "'export'"],
    ["export default", "bad.cjs", "export default 7;\n", "'export'"],
    ["import statement", "bad.cjs", 'import "node:assert";\n', "an 'import' statement"],
    ["named import", "bad.cjs", 'import { ok } from "node:assert";\n', "an 'import' statement"],
    ["top-level await", "bad.cjs", "await 0;\n", "top-level 'await'"],
    [".cts with export", "bad.cts", "export const x: number = 7;\n", "'export'"],
    [".cts with import", "bad.cts", 'import assert from "node:assert";\n', "an 'import' statement"],
  ];

  for (const [label, file, src, what] of cases) {
    test(`${label} as entrypoint`, async () => {
      const { stdout, stderr, exitCode } = await run({ [file]: src }, file);
      expect(stderr).toContain(`Cannot use ${what} in a CommonJS module`);
      expect(stderr).toContain(file.endsWith(".cts") ? '".cts" extension' : '".cjs" extension');
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  }

  test("importing a .cjs with `export` from a .mjs", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "bad.cjs": "export const x = 7;\n",
        "entry.mjs": 'import * as N from "./bad.cjs"; console.log("ns", Object.keys(N));\n',
      },
      "entry.mjs",
    );
    expect(stderr).toContain("Cannot use 'export' in a CommonJS module");
    expect(stdout).not.toContain("ns");
    expect(exitCode).not.toBe(0);
  });

  test("await import() of a .cjs with `export`", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "bad.cjs": "export const x = 7;\n",
        "entry.mjs":
          'try { await import("./bad.cjs"); console.log("loaded"); } catch (e) { console.log("caught", e.message); }\n',
      },
      "entry.mjs",
    );
    expect(stdout).toContain("caught");
    expect(stdout).toContain("Cannot use 'export' in a CommonJS module");
    expect(stdout).not.toContain("loaded");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  test("require() of a .cjs with `export`", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "bad.cjs": "export const x = 7;\n",
        "entry.cjs":
          'try { require("./bad.cjs"); console.log("loaded"); } catch (e) { console.log("caught", e.message); }\n',
      },
      "entry.cjs",
    );
    expect(stdout).toContain("caught");
    expect(stdout).toContain("Cannot use 'export' in a CommonJS module");
    expect(stdout).not.toContain("loaded");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  // The check is scoped to the .cjs/.cts extension: .js under "type":"commonjs"
  // with `export` is still accepted for now (packages in the wild depend on it).
  test('.js under "type": "commonjs" with `export` is not rejected', async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "package.json": JSON.stringify({ type: "commonjs" }),
        "ok.js": "export const x = 7; console.log(x);\n",
      },
      "ok.js",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("7\n");
    expect(exitCode).toBe(0);
  });

  // Dynamic import() is an expression, not an import statement; it is valid in CommonJS.
  test("dynamic import() expression in a .cjs is still allowed", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "ok.cjs": 'import("node:assert").then(() => console.log("ok"));\n',
      },
      "ok.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });

  test("a .cjs with no ESM syntax still runs as CommonJS", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "ok.cjs": "console.log(typeof require, typeof module);\n",
      },
      "ok.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("function object\n");
    expect(exitCode).toBe(0);
  });

  // The off-thread transpiler used to derive module_type only from the nearest
  // package.json "type" field, ignoring the .cjs extension. A .cjs file with no
  // `module`/`exports`/`require` references was then sniffed as ESM (so `module`
  // was undefined at runtime) when loaded via `import`.
  test("a .cjs with no CommonJS markers imported from a .mjs is still CommonJS", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "bare.cjs": 'console.log(eval("typeof module"), eval("typeof exports"));\n',
        "entry.mjs": 'import "./bare.cjs";\n',
      },
      "entry.mjs",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("object object\n");
    expect(exitCode).toBe(0);
  });
});
