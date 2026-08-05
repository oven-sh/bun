// A failed bare-specifier resolve busts the importer's directory cache and
// retries, and every recompute used to re-parse the directory's package.json
// and tsconfig.json into process-lifetime arenas that never free. A
// long-running process doing `try { require("optional-dep") } catch {}` from a
// directory with a package.json leaked one full parsed copy per miss (~178 KB
// per miss for a 26 KB package.json). The interner now reuses the previous
// outcome (including parse failures) when the file bytes are unchanged, so
// the arenas only grow and files only re-parse when contents change.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("dir cache busts don't re-intern unchanged package.json/tsconfig.json", async () => {
  const pkgA = JSON.stringify({ name: "dir-cache-bust-fixture", version: "1.0.0", main: "./a/x.js" });
  const pkgB = JSON.stringify({ name: "dir-cache-bust-fixture", version: "1.0.0", main: "./b/y.js" });
  // The extends target does not exist at first; the recompute must notice
  // when it appears.
  const tsWithPaths = JSON.stringify({
    extends: "./tsconfig.base.json",
    compilerOptions: { baseUrl: ".", paths: { "@app/*": ["./a/*"] } },
  });
  const tsNoPaths = JSON.stringify({
    extends: "./tsconfig.base.json",
    compilerOptions: { baseUrl: "." },
  });
  const tsBase = JSON.stringify({
    compilerOptions: { paths: { "@app/*": ["./b/*"], "@base/*": ["./c/*"] } },
  });
  using dir = tempDir("dir-cache-bust-leak", {
    "package.json": pkgA,
    "tsconfig.json": tsWithPaths,
    "a/x.js": `module.exports = "a";`,
    "b/y.js": `module.exports = "b";`,
    "c/z.js": `module.exports = "c";`,
    "c/z2.js": `module.exports = "c2";`,
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
      const misses = n => { for (let i = 0; i < n; i++) miss(); };
      const counts = () => [
        resolverInternals.packageJsonArenaLen(),
        resolverInternals.tsconfigArenaLen(),
        resolverInternals.packageJsonParseCount(),
        resolverInternals.tsconfigParseCount(),
      ];
      const out = {};

      // Settle initial parses (the first miss busts + recomputes the dir).
      miss();
      out.before = require2("@app/x");
      out.mainBefore = require2(here);
      const s0 = counts();
      misses(25);
      const s1 = counts();
      // 25 misses over unchanged files retain nothing and re-parse nothing.
      out.missGrowth = [s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2], s1[3] - s0[3]];

      // package.json-only edit: one new interned copy, tsconfig untouched,
      // and the new parse is actually served ("main" changes the resolution).
      writeFileSync(join(here, "package.json"), ${JSON.stringify(pkgB)});
      miss();
      const s2 = counts();
      out.pkgEditGrowth = [s2[0] - s1[0], s2[1] - s1[1]];
      out.mainAfter = require2(here);

      // tsconfig-only edit: one new merge, package.json untouched.
      writeFileSync(join(here, "tsconfig.json"), ${JSON.stringify(tsNoPaths)});
      miss();
      const s3 = counts();
      out.tsEditGrowth = [s3[0] - s2[0], s3[1] - s2[1]];

      // Rewriting both files with identical bytes (fresh mtimes) stays flat:
      // reuse is keyed on contents, not timestamps.
      writeFileSync(join(here, "package.json"), ${JSON.stringify(pkgB)});
      writeFileSync(join(here, "tsconfig.json"), ${JSON.stringify(tsNoPaths)});
      misses(2);
      const s4 = counts();
      out.sameBytesGrowth = [s4[0] - s3[0], s4[1] - s3[1], s4[2] - s3[2], s4[3] - s3[3]];

      // A previously-missing extends parent appearing must re-merge even
      // though the root file itself is unchanged.
      writeFileSync(join(here, "tsconfig.base.json"), ${JSON.stringify(tsBase)});
      miss();
      const s5 = counts();
      out.baseGrowth = [s5[0] - s4[0], s5[1] - s4[1]];
      out.after = require2("@app/y");
      out.viaBase = require2("@base/z");
      misses(10);
      const s6 = counts();
      out.postBaseGrowth = [s6[0] - s5[0], s6[1] - s5[1]];

      // A parent that turns malformed re-merges once (without it), stays flat
      // while malformed, and re-merges once more when fixed.
      writeFileSync(join(here, "tsconfig.base.json"), "{ this is not json !!");
      miss();
      const s7 = counts();
      out.tsMalformedGrowth = s7[1] - s6[1];
      misses(10);
      const s8 = counts();
      out.tsMalformedFlat = [s8[1] - s7[1], s8[3] - s7[3]];
      writeFileSync(join(here, "tsconfig.base.json"), ${JSON.stringify(tsBase)});
      miss();
      const s9 = counts();
      out.tsFixedGrowth = s9[1] - s8[1];
      out.viaBaseFixed = require2("@base/z2");

      // A broken root package.json is negative-cached: the failed outcome is
      // recorded (no arena growth) and unchanged bytes skip the re-parse.
      writeFileSync(join(here, "package.json"), "{ this is not json !!");
      miss();
      const s10 = counts();
      out.pkgBrokenGrowth = s10[0] - s9[0];
      misses(10);
      const s11 = counts();
      out.pkgBrokenFlat = [s11[0] - s10[0], s11[2] - s10[2]];
      writeFileSync(join(here, "package.json"), ${JSON.stringify(pkgB)});
      miss();
      const s12 = counts();
      out.pkgRestoredGrowth = s12[0] - s11[0];

      // Same for a broken root tsconfig: the no-config outcome is recorded.
      writeFileSync(join(here, "tsconfig.json"), "{ this is not json !!");
      miss();
      const s13 = counts();
      out.tsBrokenGrowth = s13[1] - s12[1];
      misses(10);
      const s14 = counts();
      out.tsBrokenFlat = [s14[1] - s13[1], s14[3] - s13[3]];
      writeFileSync(join(here, "tsconfig.json"), ${JSON.stringify(tsNoPaths)});
      miss();
      const s15 = counts();
      out.tsRestoredGrowth = s15[1] - s14[1];

      out.arenaLens = [s0[0], s0[1]];
      console.log(JSON.stringify(out));
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
  expect(out.arenaLens[0]).toBeGreaterThanOrEqual(1);
  expect(out.arenaLens[1]).toBeGreaterThanOrEqual(1);
  expect(out).toEqual({
    arenaLens: out.arenaLens,
    // tsconfig paths and package.json "main" resolve through the (re)parsed
    // structs end to end.
    before: "a",
    mainBefore: "a",
    mainAfter: "b",
    after: "b",
    viaBase: "c",
    viaBaseFixed: "c2",
    // [pkgArena, tsArena, pkgParses, tsParses] over 25 unchanged misses.
    missGrowth: [0, 0, 0, 0],
    // Each single-file edit grows only its own arena by exactly one.
    pkgEditGrowth: [1, 0],
    tsEditGrowth: [0, 1],
    // Same-bytes rewrites (fresh mtimes) retain and re-parse nothing.
    sameBytesGrowth: [0, 0, 0, 0],
    // The extends parent appearing re-merges the chain exactly once.
    baseGrowth: [0, 1],
    postBaseGrowth: [0, 0],
    // Malformed parent: one re-merge without it, flat while unchanged
    // ([arena, parses]), one re-merge when fixed.
    tsMalformedGrowth: 1,
    tsMalformedFlat: [0, 0],
    tsFixedGrowth: 1,
    // Broken root package.json: no arena growth, no re-parses while
    // unchanged, one new copy once restored.
    pkgBrokenGrowth: 0,
    pkgBrokenFlat: [0, 0],
    pkgRestoredGrowth: 1,
    // Broken root tsconfig: same story.
    tsBrokenGrowth: 0,
    tsBrokenFlat: [0, 0],
    tsRestoredGrowth: 1,
  });
  expect(exitCode).toBe(0);
});
