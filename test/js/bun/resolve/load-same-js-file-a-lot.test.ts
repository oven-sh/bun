import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

const asanIsSlowMultiplier = isASAN ? 0.2 : 1;
const count = Math.floor(10000 * asanIsSlowMultiplier);

test(
  `load the same file ${count} times`,
  async () => {
    const meta = {
      url: import.meta.url.toLocaleLowerCase().replace(".test.ts", ".js"),
      dir: import.meta.dir.toLocaleLowerCase().replace(".test.ts", ".js"),
      file: import.meta.file.toLocaleLowerCase().replace(".test.ts", ".js"),
      path: import.meta.path.toLocaleLowerCase().replace(".test.ts", ".js"),
      dirname: import.meta.dirname.toLocaleLowerCase().replace(".test.ts", ".js"),
      filename: import.meta.filename.toLocaleLowerCase().replace(".test.ts", ".js"),
    };
    const prev = Bun.unsafe.gcAggressionLevel();
    Bun.unsafe.gcAggressionLevel(0);
    for (let i = 0; i < count; i++) {
      const {
        default: { url, dir, file, path, dirname, filename },
      } = await import("./load-same-js-file-a-lot.js?i=" + i);
      expect(url).toBe(meta.url + "?i=" + i);
      expect(dir).toBe(meta.dir);
      expect(file).toBe(meta.file);
      expect(path).toBe(meta.path);
      expect(dirname).toBe(meta.dirname);
      expect(filename).toBe(meta.filename);
    }
    Bun.gc(true);
    Bun.unsafe.gcAggressionLevel(prev);
  },
  isDebug || isASAN ? 20_000 : 5000,
);

// The module loader's per-transpile arena reset (ModuleLoader::reset_arena)
// runs after every *synchronous* transpile cycle — require() takes this path;
// dynamic import() of non-main JS-like modules routes through the concurrent
// transpiler store and never reaches it. Under --smol the heap is destroyed
// outright (free_all); otherwise the warm heap is retained while its
// footprint stays under an 8 MiB cap and recycled once a module pushes it
// past the cap. On the success path the give-back guard inside the transpile
// hook resets the arena before parking it, so reset_arena's over-limit branch
// only sees a fat arena on the parse-error path (the arena is parked un-reset
// there so error log spans stay valid) — hence the oversized *broken* modules
// below.
//
// On debug builds the branch taken is asserted via the BUN_DEBUG_ModuleLoader
// scoped log, so reverting to an unconditional reset (or inverting the smol
// gate) fails this test. In any build, a bug in either reset path (freeing
// memory a parked source still references, corrupting the retained heap)
// would crash or corrupt module evaluation in the subprocess.
for (const smol of [false, true]) {
  test(
    `transpile arena reset policy (${smol ? "--smol" : "default"})`,
    async () => {
      const iters = isASAN || isDebug ? 50 : 200;
      const brokenCount = isASAN || isDebug ? 1 : 2;

      // Each big module must push the transpile arena past the 8 MiB retain
      // cap before the parser finishes: 150k statements at well over ~55
      // bytes of arena footprint each (Stmt + S.Local + Decl + Binding +
      // E.Number + symbol) clears the cap with margin.
      const bigLines: string[] = [];
      for (let i = 0; i < 150_000; i++) {
        bigLines.push(`const v${i} = ${i};`);
      }
      const bigValid = bigLines.join("\n") + "\nexport const sum = v0 + v149999;";
      // Syntax error at the END so the parser allocates the full AST into
      // the arena before failing; the error path parks the arena un-reset
      // and reset_arena reclaims it (over-limit branch in default mode).
      const bigBroken = bigLines.join("\n") + "\n}";

      const files: Record<string, string> = {
        "big_valid.ts": bigValid,
        "driver.ts": `
          let total = 0;
          let caught = 0;
          for (let i = 0; i < ${iters}; i++) {
            // require(), not import(): dynamic import of a non-main module
            // goes through the concurrent transpiler store and skips the
            // module loader's synchronous arena reset entirely.
            const m = require("./small_" + i + ".ts");
            total += m.value;
            if (i % 10 === 0) Bun.gc(true);
          }
          for (let i = 0; i < ${brokenCount}; i++) {
            try {
              require("./big_broken_" + i + ".ts");
            } catch {
              caught++;
            }
            Bun.gc(true);
          }
          total += require("./big_valid.ts").sum;
          Bun.gc(true);
          console.log("total=" + total + " caught=" + caught);
        `,
      };
      for (let i = 0; i < iters; i++) {
        files[`small_${i}.ts`] = `export const value: number = 1;\n`;
      }
      for (let i = 0; i < brokenCount; i++) {
        files[`big_broken_${i}.ts`] = bigBroken;
      }

      using dir = tempDir("transpile-arena-reset", files);

      const cmd = [bunExe()];
      if (smol) cmd.push("--smol");
      cmd.push("driver.ts");

      await using proc = Bun.spawn({
        cmd,
        // The scoped log is compiled out of release builds; only ask for it
        // (and assert on it) when the build under test is a debug build.
        env: isDebug ? { ...bunEnv, BUN_DEBUG_ModuleLoader: "1" } : bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain(`total=${iters + 149999} caught=${brokenCount}`);
      if (isDebug) {
        // Differential assertions: count reset_arena branch logs. Pre-change
        // behavior (unconditional destroy/new) or an inverted smol gate
        // produces the wrong branch tags and fails here.
        const logs = stdout + stderr;
        const occurrences = (needle: string) => logs.split(needle).length - 1;
        if (smol) {
          // --smol must always take the full-destroy path.
          expect(occurrences("reset_arena: free_all")).toBeGreaterThanOrEqual(iters + brokenCount);
          expect(occurrences("reset_arena: retained")).toBe(0);
          expect(occurrences("reset_arena: recycled")).toBe(0);
        } else {
          // Default mode: post-success resets see an already-recycled arena
          // (under the cap, so retained); each oversized parse failure parks
          // a fat arena and must trip the over-limit recycle. If the broken
          // fixture ever stops clearing the 8 MiB cap, the recycled
          // assertion fails instead of silently losing branch coverage.
          expect(occurrences("reset_arena: retained")).toBeGreaterThanOrEqual(iters);
          expect(occurrences("reset_arena: recycled")).toBeGreaterThanOrEqual(brokenCount);
          expect(occurrences("reset_arena: free_all")).toBe(0);
        }
      } else {
        expect(stderr).toBe("");
      }
      expect(exitCode).toBe(0);
    },
    isDebug || isASAN ? 120_000 : 30_000,
  );
}

test(`load the same empty JS file ${count} times`, async () => {
  const prev = Bun.unsafe.gcAggressionLevel();
  Bun.unsafe.gcAggressionLevel(0);
  for (let i = 0; i < count; i++) {
    const { default: obj } = await import("./load-same-empty-js-file-a-lot.js?i=" + i);
    expect(obj).toEqual({});
  }
  Bun.gc(true);
  Bun.unsafe.gcAggressionLevel(prev);
});
