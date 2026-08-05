// A failed bare-specifier resolve busts the importer's directory cache and
// retries, and every recompute used to re-parse the directory's package.json
// and tsconfig.json into process-lifetime arenas that never free. A
// long-running process doing `try { require("optional-dep") } catch {}` from a
// directory with a package.json leaked one full parsed copy per miss (~178 KB
// per miss for a 26 KB package.json). The interner now reuses the existing
// allocation when the file bytes are unchanged, so the arenas only grow when
// contents actually change.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("dir cache busts don't re-intern unchanged package.json/tsconfig.json", async () => {
  const pkg = { name: "dir-cache-bust-fixture", version: "1.0.0" };
  const tsconfig = (dir: string) => ({
    compilerOptions: { baseUrl: ".", paths: { "@app/*": [`./${dir}/*`] } },
  });
  using dir = tempDir("dir-cache-bust-leak", {
    "package.json": JSON.stringify(pkg),
    "tsconfig.json": JSON.stringify(tsconfig("a")),
    "a/x.js": `module.exports = "a";`,
    "b/y.js": `module.exports = "b";`,
    // The presence of node_modules keeps the runtime's auto-install out of
    // the failed resolves below (no registry traffic).
    "node_modules/.gitkeep": "",
    "main.mjs": `
      import { resolverInternals } from "bun:internal-for-testing";
      import { createRequire } from "node:module";
      import { writeFileSync } from "node:fs";
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
      writeFileSync("package.json", ${JSON.stringify(JSON.stringify({ ...pkg, description: "edited" }))});
      writeFileSync("tsconfig.json", ${JSON.stringify(JSON.stringify(tsconfig("b")))});
      miss();
      const p2 = pkgLen(), t2 = tsLen();
      for (let i = 0; i < 25; i++) miss();
      const p3 = pkgLen(), t3 = tsLen();
      const after = require2("@app/y");
      console.log(JSON.stringify({ before, after, p0, p1, p2, p3, t0, t1, t2, t3 }));
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
    // 25 misses over unchanged files retain nothing.
    pkgMissGrowth: out.p1 - out.p0,
    tsMissGrowth: out.t1 - out.t0,
    // An edit is picked up as exactly one new interned copy.
    pkgEditGrowth: out.p2 - out.p1,
    tsEditGrowth: out.t2 - out.t1,
    // And misses after the edit are flat again.
    pkgPostEditGrowth: out.p3 - out.p2,
    tsPostEditGrowth: out.t3 - out.t2,
  }).toEqual({
    before: "a",
    after: "b",
    pkgMissGrowth: 0,
    tsMissGrowth: 0,
    pkgEditGrowth: 1,
    tsEditGrowth: 1,
    pkgPostEditGrowth: 0,
    tsPostEditGrowth: 0,
  });
  expect(exitCode).toBe(0);
});
