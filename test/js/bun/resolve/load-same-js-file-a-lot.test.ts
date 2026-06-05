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

// ModuleLoader::reset_arena: --smol destroys the transpile arena every cycle;
// otherwise it retains the warm heap under an 8 MiB cap and recycles when over.
// The over-cap branch is only reachable via the parse-error path (success
// resets the arena before parking it), hence the oversized broken modules.
// Debug builds assert the branch taken via the BUN_DEBUG_ModuleLoader log.
for (const smol of [false, true]) {
  test(
    `transpile arena reset policy (${smol ? "--smol" : "default"})`,
    async () => {
      const iters = isASAN || isDebug ? 50 : 200;
      const brokenCount = isASAN || isDebug ? 1 : 2;

      // 150k statements pushes the transpile arena well past the 8 MiB cap.
      const bigLines: string[] = [];
      for (let i = 0; i < 150_000; i++) {
        bigLines.push(`const v${i} = ${i};`);
      }
      const bigValid = bigLines.join("\n") + "\nexport const sum = v0 + v149999;";
      // Syntax error at the end so the full AST is in the arena before failing.
      const bigBroken = bigLines.join("\n") + "\n}";

      const files: Record<string, string> = {
        "big_valid.ts": bigValid,
        "driver.ts": `
          let total = 0;
          let caught = 0;
          for (let i = 0; i < ${iters}; i++) {
            // require(), not import(): dynamic import skips the synchronous
            // arena reset (concurrent transpiler store).
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
        // The scoped log is compiled out of release builds.
        env: isDebug ? { ...bunEnv, BUN_DEBUG_ModuleLoader: "1" } : bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain(`total=${iters + 149999} caught=${brokenCount}`);
      if (isDebug) {
        const logs = stdout + stderr;
        const occurrences = (needle: string) => logs.split(needle).length - 1;
        if (smol) {
          expect(occurrences("reset_arena: free_all")).toBeGreaterThanOrEqual(iters + brokenCount);
          expect(occurrences("reset_arena: retained")).toBe(0);
          expect(occurrences("reset_arena: recycled")).toBe(0);
        } else {
          // Each oversized parse failure must trip the over-cap recycle; if the
          // broken fixture stops clearing the cap, this fails rather than
          // silently losing branch coverage.
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
