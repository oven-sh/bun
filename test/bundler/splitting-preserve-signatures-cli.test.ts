import { describe, expect, test } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";
import { readdirSync } from "fs";
import { join } from "path";

describe("bundler", () => {
  describe("preserve-entry-signatures CLI", () => {
    test("strict mode creates separate common chunk", async () => {
      const dir = tempDirWithFiles("preserve-sig-test", {
        "entry-a.js": `
          import { util } from "./util.js";
          export const a = "a" + util;
        `,
        "entry-b.js": `
          import { util } from "./util.js";
          export const b = "b" + util;
        `,
        "util.js": `export const util = "util";`,
      });

      const outDir = join(dir, "out");

      // Run build with strict mode
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          join(dir, "entry-a.js"),
          join(dir, "entry-b.js"),
          "--outdir", outDir,
          "--splitting",
          "--preserve-entry-signatures=strict"
        ],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const files = readdirSync(outDir);
      // With strict mode: 2 entries + 1 common chunk
      expect(files.length).toBe(3);
      // Check we have both entry files
      expect(files).toContain("entry-a.js");
      expect(files).toContain("entry-b.js");

      // Check that common chunk has util
      const commonChunk = files.find(f => f !== "entry-a.js" && f !== "entry-b.js");
      expect(commonChunk).toBeTruthy();
      const commonContent = await Bun.file(join(outDir, commonChunk!)).text();
      expect(commonContent).toContain('util = "util"');
    });

    test("allow-extension mode reduces chunks", async () => {
      const dir = tempDirWithFiles("preserve-sig-test2", {
        "entry-a.js": `
          import { util } from "./util.js";
          export const a = "a" + util;
        `,
        "entry-b.js": `
          import { util } from "./util.js";
          export const b = "b" + util;
        `,
        "util.js": `export const util = "util";`,
      });

      const outDir = join(dir, "out");

      // Run build with allow-extension mode
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          join(dir, "entry-a.js"),
          join(dir, "entry-b.js"),
          "--outdir", outDir,
          "--splitting",
          "--preserve-entry-signatures=allow-extension"
        ],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const files = readdirSync(outDir);
      // With allow-extension: only 2 entry files (util merged into one)
      expect(files.length).toBe(2);
      expect(files).toContain("entry-a.js");
      expect(files).toContain("entry-b.js");

      // One of the entries should have util
      const entryA = await Bun.file(join(outDir, "entry-a.js")).text();
      const entryB = await Bun.file(join(outDir, "entry-b.js")).text();
      const utilInA = entryA.includes('util = "util"');
      const utilInB = entryB.includes('util = "util"');
      
      expect(utilInA !== utilInB).toBe(true); // Exactly one has util
    });
  });
});