import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, symlinkSync } from "fs";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

async function run(cwd: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: normalizeBunSnapshot(stdout, cwd).replace(/in \d+ms/, "in <time>"),
    stderr: normalizeBunSnapshot(stderr, cwd),
    exitCode,
  };
}

// Each error line of `bun build --check` output.
function errorLines(stderr: string) {
  return stderr.split("\n").filter(line => line.startsWith("error: "));
}

describe("bun build --check", () => {
  test.concurrent("reports a cycle with each import in it and writes no files", async () => {
    using dir = tempDir("build-check-cycle", {
      "index.ts": `import { a } from "./a";\nconsole.log(a());\n`,
      "a.ts": `import { b } from "./b";\nexport const a = () => b();\n`,
      "b.ts": `import { c } from "./c";\nexport const b = () => c();\n`,
      "c.ts": `import { a } from "./a";\nexport const c = () => a;\n`,
    });
    const before = readdirSync(String(dir)).sort();

    const result = await run(String(dir), ["build", "./index.ts", "--check"]);

    expect(result.stderr).toMatchInlineSnapshot(`
      "1 | import { b } from "./b";
                            ^
      error: Circular dependency: a.ts -> b.ts -> c.ts -> a.ts
          at <dir>/a.ts:1:19

      1 | import { c } from "./c";
                            ^
      note: b.ts imports c.ts here:
         at <dir>/b.ts:1:19
      1 | import { a } from "./a";
                            ^
      note: c.ts imports a.ts here:
         at <dir>/c.ts:1:19"
    `);
    expect(result.stdout).toBe("");
    expect(readdirSync(String(dir)).sort()).toEqual(before);
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("exits 0 and writes no files when there is no cycle", async () => {
    using dir = tempDir("build-check-ok", {
      "index.ts": `import { a } from "./a";\nconsole.log(a);\n`,
      "a.ts": `import { b } from "./b";\nexport const a = b;\n`,
      "b.ts": `export const b = 1;\n`,
    });
    const before = readdirSync(String(dir)).sort();

    const result = await run(String(dir), ["build", "./index.ts", "--check"]);

    expect(result).toEqual({ stdout: "Checked 3 modules in <time>", stderr: "", exitCode: 0 });
    expect(readdirSync(String(dir)).sort()).toEqual(before);
  });

  test.concurrent("reports a resolve error and a cycle in one run", async () => {
    // An import that does not resolve stops the scan of its file, so the cycle is in other files.
    using dir = tempDir("build-check-resolve-error", {
      "index.ts": `import "./broken";\nimport "./a";\n`,
      "broken.ts": `import "./missing";\n`,
      "a.ts": `import "./b";\n`,
      "b.ts": `import "./a";\n`,
    });

    const result = await run(String(dir), ["build", "./index.ts", "--check"]);

    expect(errorLines(result.stderr)).toEqual([
      `error: Could not resolve: "./missing"`,
      "error: Circular dependency: a.ts -> b.ts -> a.ts",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("follows export-from, side-effect imports, and require()", async () => {
    using dir = tempDir("build-check-kinds", {
      "index.ts": `import "./reexport";\nimport "./bare";\nrequire("./cjs.js");\n`,
      "reexport.ts": `export { x } from "./reexport-back";\n`,
      "reexport-back.ts": `import "./reexport";\nexport const x = 1;\n`,
      "bare.ts": `import "./bare-back";\n`,
      "bare-back.ts": `import "./bare";\n`,
      "cjs.js": `module.exports = require("./cjs-back.js");\n`,
      "cjs-back.js": `require("./cjs.js");\nmodule.exports = 1;\n`,
    });

    const result = await run(String(dir), ["build", "./index.ts", "--check"]);

    expect(errorLines(result.stderr)).toEqual([
      "error: Circular dependency: reexport.ts -> reexport-back.ts -> reexport.ts",
      "error: Circular dependency: bare.ts -> bare-back.ts -> bare.ts",
      "error: Circular dependency: cjs.js -> cjs-back.js -> cjs.js",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("reports a file that imports itself", async () => {
    using dir = tempDir("build-check-self", {
      "index.ts": `import "./self";\n`,
      "self.ts": `import "./self";\nexport const x = 1;\n`,
    });

    const result = await run(String(dir), ["build", "./index.ts", "--check"]);

    expect(errorLines(result.stderr)).toEqual(["error: Circular dependency: self.ts -> self.ts"]);
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("skips type-only imports, import(), and import defer", async () => {
    using dir = tempDir("build-check-skip", {
      "index.ts": `import { a } from "./a";\nconsole.log(a);\n`,
      "a.ts": [
        `import type { T } from "./type-only";`,
        `import { U } from "./used-as-type";`,
        `export type { V } from "./export-type";`,
        `import defer * as deferred from "./deferred";`,
        `export const a: T | U = 1;`,
        `export const load = () => import("./lazy");`,
        `export const read = () => deferred.d;`,
      ].join("\n"),
      "type-only.ts": `import { a } from "./a";\nexport type T = typeof a;\n`,
      "used-as-type.ts": `import { a } from "./a";\nexport type U = typeof a;\n`,
      "export-type.ts": `import { a } from "./a";\nexport type V = typeof a;\n`,
      "lazy.ts": `import { a } from "./a";\nexport default a;\n`,
      "deferred.ts": `import { a } from "./a";\nexport const d = a;\n`,
    });

    const result = await run(String(dir), ["build", "./index.ts", "--check"]);

    expect(result).toEqual({ stdout: "Checked 4 modules in <time>", stderr: "", exitCode: 0 });
  });

  test.concurrent("reports a cycle once when several entry points reach it", async () => {
    using dir = tempDir("build-check-entries", {
      "one.ts": `import "./a";\n`,
      "two.ts": `import "./b";\n`,
      "a.ts": `import "./b";\n`,
      "b.ts": `import "./a";\n`,
    });

    const result = await run(String(dir), ["build", "./one.ts", "./two.ts", "--check"]);

    expect(errorLines(result.stderr)).toEqual(["error: Circular dependency: a.ts -> b.ts -> a.ts"]);
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("skips cycles inside node_modules", async () => {
    using dir = tempDir("build-check-node-modules", {
      "index.ts": `import { x } from "pkg";\nconsole.log(x);\n`,
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "index.js" }),
      "node_modules/pkg/index.js": `export { x } from "./other.js";\n`,
      "node_modules/pkg/other.js": `import "./index.js";\nexport const x = 1;\n`,
    });

    const result = await run(String(dir), ["build", "./index.ts", "--check"]);

    expect(result).toEqual({ stdout: "Checked 3 modules in <time>", stderr: "", exitCode: 0 });
  });

  test.concurrent("follows a workspace package that node_modules links to", async () => {
    using dir = tempDir("build-check-workspace", {
      "app/index.ts": `import { shared } from "shared";\nexport const app = 1;\nconsole.log(shared);\n`,
      "shared/package.json": JSON.stringify({ name: "shared", main: "index.ts" }),
      "shared/index.ts": `import { app } from "../app/index.ts";\nexport const shared = app;\n`,
    });
    mkdirSync(join(String(dir), "app", "node_modules"));
    symlinkSync(join(String(dir), "shared"), join(String(dir), "app", "node_modules", "shared"), "junction");

    const result = await run(String(dir), ["build", "./app/index.ts", "--check"]);

    expect(errorLines(result.stderr)).toEqual([
      "error: Circular dependency: app/index.ts -> shared/index.ts -> app/index.ts",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("follows a re-export that a build would defer", async () => {
    // With "sideEffects": false, a build never loads unused.ts. Unbundled code does.
    using dir = tempDir("build-check-barrel", {
      "package.json": JSON.stringify({ name: "app", sideEffects: false }),
      "index.ts": `import { used } from "./barrel";\nconsole.log(used);\n`,
      "barrel.ts": `export { used } from "./used";\nexport { unused } from "./unused";\n`,
      "used.ts": `export const used = 1;\n`,
      "unused.ts": `import { used } from "./barrel";\nexport const unused = used;\n`,
    });

    const result = await run(String(dir), ["build", "./index.ts", "--check"]);

    expect(errorLines(result.stderr)).toEqual(["error: Circular dependency: barrel.ts -> unused.ts -> barrel.ts"]);
    expect(result.exitCode).toBe(1);
  });

  test.concurrent.each(["--outdir=out", "--outfile=out.js", "--metafile=meta.json", "--compile", "--no-bundle"])(
    "rejects %s",
    async flag => {
      using dir = tempDir("build-check-conflict", {
        "index.ts": `console.log(1);\n`,
      });
      const name = flag.split("=")[0];

      const result = await run(String(dir), ["build", "./index.ts", "--check", flag]);

      expect(result).toEqual({
        stdout: "",
        stderr: `error: --check writes no files, so it cannot be used with ${name}`,
        exitCode: 1,
      });
      expect(readdirSync(String(dir))).toEqual(["index.ts"]);
    },
  );
});

describe("Bun.build({ check: true })", () => {
  const files = {
    "index.ts": `import { a } from "./a";\nconsole.log(a());\n`,
    "a.ts": `import { b } from "./b";\nexport const a = () => b();\n`,
    "b.ts": `import { a } from "./a";\nexport const b = () => a;\n`,
  };

  test.concurrent("returns the cycle in logs", async () => {
    using dir = tempDir("build-check-api", {
      ...files,
      "build.ts": `
        const result = await Bun.build({ entrypoints: ["./index.ts"], check: true, throw: false });
        console.log(JSON.stringify({
          success: result.success,
          outputs: result.outputs.length,
          logs: result.logs.map(log => ({
            level: log.level,
            message: log.message,
            file: log.position?.file.replaceAll("\\\\", "/").split("/").pop(),
            line: log.position?.line,
            column: log.position?.column,
          })),
        }));
      `,
    });

    const result = await run(String(dir), ["build.ts"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      success: false,
      outputs: 0,
      logs: [
        { level: "error", message: "Circular dependency: a.ts -> b.ts -> a.ts", file: "a.ts", line: 1, column: 19 },
      ],
    });
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("rejects when throw is not false", async () => {
    using dir = tempDir("build-check-api-throw", {
      ...files,
      "build.ts": `
        try {
          await Bun.build({ entrypoints: ["./index.ts"], check: true });
          console.log("resolved");
        } catch (error) {
          console.log(error.constructor.name, error.errors.map(e => e.message).join("|"));
        }
      `,
    });

    const result = await run(String(dir), ["build.ts"]);

    expect(result).toEqual({
      stdout: "AggregateError Circular dependency: a.ts -> b.ts -> a.ts",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("succeeds with no outputs when there is no cycle", async () => {
    using dir = tempDir("build-check-api-ok", {
      "index.ts": `import { a } from "./a";\nconsole.log(a);\n`,
      "a.ts": `export const a = 1;\n`,
    });

    const result = await Bun.build({ entrypoints: [join(String(dir), "index.ts")], check: true });

    expect({ success: result.success, outputs: result.outputs.length, logs: result.logs.length }).toEqual({
      success: true,
      outputs: 0,
      logs: 0,
    });
    expect(readdirSync(String(dir)).sort()).toEqual(["a.ts", "index.ts"]);
  });

  test.each(["outdir", "metafile", "compile"])("throws with %s", async name => {
    using dir = tempDir("build-check-api-conflict", { "index.ts": `console.log(1);\n` });
    const out = join(String(dir), "out");
    const extra = { outdir: { outdir: out }, metafile: { metafile: true }, compile: { compile: { outfile: out } } }[
      name
    ];

    expect(() => Bun.build({ entrypoints: [join(String(dir), "index.ts")], check: true, ...extra })).toThrow(
      `check writes no files, so it cannot be used with ${name}`,
    );
    expect(readdirSync(String(dir))).toEqual(["index.ts"]);
  });
});
