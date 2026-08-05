// A failed bare-specifier resolve busts the importer's directory cache and
// retries, and every recompute used to re-parse the directory's package.json
// and tsconfig.json into process-lifetime arenas that never free. A
// long-running process doing `try { require("optional-dep") } catch {}` from a
// directory with a package.json leaked one full parsed copy per miss (~178 KB
// per miss for a 26 KB package.json). The interner now reuses the existing
// allocation when the file bytes (and, for tsconfig, the whole extends chain)
// are unchanged, so the arenas only grow when contents actually change.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("dir cache busts don't re-intern unchanged package.json/tsconfig.json", async () => {
  const pkg = { name: "dir-cache-bust-fixture", version: "1.0.0" };
  // The extends target does not exist at first; the recompute must notice
  // when it appears.
  const tsconfigWithPaths = {
    extends: "./tsconfig.base.json",
    compilerOptions: { baseUrl: ".", paths: { "@app/*": ["./a/*"] } },
  };
  const tsconfigNoPaths = {
    extends: "./tsconfig.base.json",
    compilerOptions: { baseUrl: "." },
  };
  const tsconfigBase = {
    compilerOptions: { paths: { "@app/*": ["./b/*"], "@base/*": ["./c/*"] } },
  };
  using dir = tempDir("dir-cache-bust-leak", {
    "package.json": JSON.stringify(pkg),
    "tsconfig.json": JSON.stringify(tsconfigWithPaths),
    "a/x.js": `module.exports = "a";`,
    "b/y.js": `module.exports = "b";`,
    "c/z.js": `module.exports = "c";`,
    // The presence of node_modules keeps the runtime's auto-install out of
    // the failed resolves below (no registry traffic).
    "node_modules/.gitkeep": "",
    "main.mjs": `
      import { resolverInternals } from "bun:internal-for-testing";
      import { createRequire } from "node:module";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      const here = import.meta.dir;
      const require2 = createRequire(import.meta.url);
      const miss = () => {
        try {
          require2("pkg-that-does-not-exist-xyz");
        } catch {}
      };
      const pkgLen = resolverInternals.packageJsonArenaLen;
      const tsLen = resolverInternals.tsconfigArenaLen;

      // Settle initial parses (the first miss busts + recomputes the dir).
      miss();
      const before = require2("@app/x");
      const p0 = pkgLen(), t0 = tsLen();
      for (let i = 0; i < 25; i++) miss();
      const p1 = pkgLen(), t1 = tsLen();

      // Real edits must still be picked up by the bust: one new interned copy
      // each, then flat again.
      writeFileSync(join(here, "package.json"), ${JSON.stringify(JSON.stringify({ ...pkg, description: "edited" }))});
      writeFileSync(join(here, "tsconfig.json"), ${JSON.stringify(JSON.stringify(tsconfigNoPaths))});
      miss();
      const p2 = pkgLen(), t2 = tsLen();
      for (let i = 0; i < 25; i++) miss();
      const p3 = pkgLen(), t3 = tsLen();

      // A previously-missing extends parent appearing must re-merge even
      // though the root file itself is unchanged.
      writeFileSync(join(here, "tsconfig.base.json"), ${JSON.stringify(JSON.stringify(tsconfigBase))});
      miss();
      const p4 = pkgLen(), t4 = tsLen();
      const after = require2("@app/y");
      const viaBase = require2("@base/z");
      for (let i = 0; i < 10; i++) miss();
      const p5 = pkgLen(), t5 = tsLen();
      console.log(JSON.stringify({ before, after, viaBase, p0, p1, p2, p3, p4, p5, t0, t1, t2, t3, t4, t5 }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const out = JSON.parse(stdout);
  expect(out.p0).toBeGreaterThanOrEqual(1);
  expect(out.t0).toBeGreaterThanOrEqual(1);
  expect({
    // tsconfig paths resolve through the (re)parsed configs end to end.
    before: out.before,
    after: out.after,
    viaBase: out.viaBase,
    // 25 misses over unchanged files retain nothing (including re-probing the
    // still-missing extends parent).
    pkgMissGrowth: out.p1 - out.p0,
    tsMissGrowth: out.t1 - out.t0,
    // An edit is picked up as exactly one new interned copy.
    pkgEditGrowth: out.p2 - out.p1,
    tsEditGrowth: out.t2 - out.t1,
    // And misses after the edit are flat again.
    pkgPostEditGrowth: out.p3 - out.p2,
    tsPostEditGrowth: out.t3 - out.t2,
    // The extends parent appearing re-merges the chain exactly once.
    pkgBaseGrowth: out.p4 - out.p3,
    tsBaseGrowth: out.t4 - out.t3,
    pkgFinalGrowth: out.p5 - out.p4,
    tsFinalGrowth: out.t5 - out.t4,
  }).toEqual({
    before: "a",
    after: "b",
    viaBase: "c",
    pkgMissGrowth: 0,
    tsMissGrowth: 0,
    pkgEditGrowth: 1,
    tsEditGrowth: 1,
    pkgPostEditGrowth: 0,
    tsPostEditGrowth: 0,
    pkgBaseGrowth: 0,
    tsBaseGrowth: 1,
    pkgFinalGrowth: 0,
    tsFinalGrowth: 0,
  });
  expect(exitCode).toBe(0);
});
