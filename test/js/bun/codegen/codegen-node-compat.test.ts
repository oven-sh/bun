// Verifies src/codegen/* runs under Node (with type stripping) and contains no
// Bun-only APIs. Before the esbuild port these scripts used Bun.build,
// Bun.Transpiler, Bun.file, import.meta.require, etc.
import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const codegenDir = path.join(repoRoot, "src", "codegen");

function findNode(): string | null {
  // Walk PATH manually so we don't touch Bun.which in a test asserting we
  // don't use Bun APIs.
  const exe = process.platform === "win32" ? "node.exe" : "node";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, exe);
    try {
      const v = spawnSync(p, ["--version"], { encoding: "utf8" });
      if (v.status === 0) return p;
    } catch {}
  }
  return null;
}

const node = findNode();

describe("codegen sources are Bun-API free", () => {
  // client-js.ts emits code that runs inside the built bun binary and
  // legitimately references Bun globals; node-loader.ts guards its dynamic
  // import with a runtime check.
  const allow = new Set(["client-js.ts", "node-loader.ts"]);
  const files = globSync("**/*.ts", { cwd: codegenDir }).filter(f => !f.endsWith(".d.ts") && !allow.has(path.basename(f)));

  test("no Bun.* / bun:* / import.meta.{dir,main,require} references", () => {
    expect(files.length).toBeGreaterThan(15);
    const offenders: string[] = [];
    const banned =
      /\bBun\.(?!(?:js|com|sh)\b)\w|from\s+["']bun(?::|["'])|\bimport\.meta\.(?:dir\b|main\b|path\b|file\b|require\b)/;
    for (const f of files) {
      const src = readFileSync(path.join(codegenDir, f), "utf8")
        .replace(/\/\*[^]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
      if (banned.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  test("src/node-fallbacks/build-fallbacks.ts is Bun-API free", () => {
    const src = readFileSync(path.join(repoRoot, "src", "node-fallbacks", "build-fallbacks.ts"), "utf8");
    expect(src).not.toMatch(/\bBun\.[$\w]/);
  });
});

describe.skipIf(!node)("codegen scripts execute under Node", () => {
  test("generate-string-map.ts", () => {
    using dir = tempDir("codegen-node", {
      "map.string-map.ts": `export default { name: "smoke", valueTy: "u8", entries: [["a", 1], ["bb", 2]] };\n`,
    });
    const out = path.join(String(dir), "smoke.generated.rs");
    const r = spawnSync(
      node!,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--import",
        path.join(codegenDir, "node-loader.ts"),
        path.join(codegenDir, "generate-string-map.ts"),
        path.join(String(dir), "map.string-map.ts"),
        out,
      ],
      { encoding: "utf8", env: bunEnv },
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("fn smoke");
  });

  test("bindgenv2 list-outputs", () => {
    const sources = globSync("src/**/*.bindv2.ts", { cwd: repoRoot }).map(f => path.join(repoRoot, f));
    expect(sources.length).toBeGreaterThan(0);
    const r = spawnSync(
      node!,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--import",
        path.join(codegenDir, "node-loader.ts"),
        path.join(codegenDir, "bindgenv2", "script.ts"),
        "--command=list-outputs",
        `--sources=${sources.join(",")}`,
        "--codegen-path=/tmp",
      ],
      { encoding: "utf8", env: bunEnv, cwd: repoRoot },
    );
    expect(r.stderr).not.toContain("Error");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(".cpp");
  });

  test("create-hash-table.ts", () => {
    using dir = tempDir("codegen-lut", {
      "in.txt": `/* @begin smokeTable\n  foo  fooFunc  Function 0\n@end */\n`,
    });
    const out = path.join(String(dir), "out.h");
    const r = spawnSync(
      node!,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--import",
        path.join(codegenDir, "node-loader.ts"),
        path.join(codegenDir, "create-hash-table.ts"),
        path.join(String(dir), "in.txt"),
        out,
      ],
      { encoding: "utf8", env: { ...bunEnv, TARGET_PLATFORM: process.platform } },
    );
    // perl might not be on every CI image; skip rather than fail in that case
    if (/perl/.test(r.stderr ?? "") && r.status !== 0) return;
    expect(r.status).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("#pragma once");
  });
});

// The bundled src/js modules are now produced by esbuild instead of Bun.build.
// Loading every public builtin proves JSC's builtin parser accepts the new
// output (catches `view.is8Bit()`, `__commonJS` wrapping, trailing `//!`
// swallowing the wrapper close, stray `__name`, ...).
test("all builtin modules load in the built bun", async () => {
  const mods = builtinModules.filter(m => !m.startsWith("_") && !m.startsWith("bun:internal"));
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `for (const m of ${JSON.stringify(mods)}) require(m); console.log("loaded", ${mods.length});`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("Error parsing builtin");
  expect(stderr).not.toContain("is8Bit");
  expect(stdout.trim()).toBe(`loaded ${mods.length}`);
  expect(code).toBe(0);
});
