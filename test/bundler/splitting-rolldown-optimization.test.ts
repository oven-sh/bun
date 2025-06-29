import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Comprehensive test suite for the Rolldown chunk extension optimization
describe("bundler", () => {
  describe("Rolldown chunk extension optimization", () => {
    test("basic shared module - strict mode", async () => {
      const dir = tempDirWithFiles("rolldown-test1", {
        "entry-a.js": `
          import { shared } from "./shared.js";
          export function useA() { return "A uses " + shared(); }
        `,
        "entry-b.js": `
          import { shared } from "./shared.js";
          export function useB() { return "B uses " + shared(); }
        `,
        "shared.js": `export function shared() { return "shared-value"; }`,
      });

      const outDir = join(dir, "out");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "entry-a.js",
          "entry-b.js",
          "--outdir",
          outDir,
          "--splitting",
          "--preserve-entry-signatures=strict",
        ],
        env: bunEnv,
        cwd: dir,
      });

      expect(await proc.exited).toBe(0);
      const files = readdirSync(outDir);
      expect(files.length).toBe(3); // 2 entries + 1 common chunk
    });

    test("basic shared module - allow-extension mode", async () => {
      const dir = tempDirWithFiles("rolldown-test2", {
        "entry-a.js": `
          import { shared } from "./shared.js";
          export function useA() { return "A uses " + shared(); }
        `,
        "entry-b.js": `
          import { shared } from "./shared.js";
          export function useB() { return "B uses " + shared(); }
        `,
        "shared.js": `export function shared() { return "shared-value"; }`,
      });

      const outDir = join(dir, "out");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "entry-a.js",
          "entry-b.js",
          "--outdir",
          outDir,
          "--splitting",
          "--preserve-entry-signatures=allow-extension",
        ],
        env: bunEnv,
        cwd: dir,
      });

      expect(await proc.exited).toBe(0);
      const files = readdirSync(outDir);
      expect(files.length).toBe(2); // Optimization merged shared into an entry

      // Verify cross-imports
      const entryA = readFileSync(join(outDir, "entry-a.js"), "utf-8");
      const entryB = readFileSync(join(outDir, "entry-b.js"), "utf-8");

      // One should have the shared code, other should import
      const hasShared = (content: string) => content.includes("shared-value");
      expect(hasShared(entryA) !== hasShared(entryB)).toBe(true);
    });

    test("multiple shared modules", async () => {
      const dir = tempDirWithFiles("rolldown-test3", {
        "entry-a.js": `
          import { x } from "./x.js";
          import { y } from "./y.js";
          import { z } from "./z.js";
          export const a = x + y + z;
        `,
        "entry-b.js": `
          import { x } from "./x.js";
          import { y } from "./y.js";
          import { z } from "./z.js";
          export const b = x + y + z;
        `,
        "x.js": `export const x = "x";`,
        "y.js": `export const y = "y";`,
        "z.js": `export const z = "z";`,
      });

      const outDir = join(dir, "out");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "entry-a.js",
          "entry-b.js",
          "--outdir",
          outDir,
          "--splitting",
          "--preserve-entry-signatures=allow-extension",
        ],
        env: bunEnv,
        cwd: dir,
      });

      expect(await proc.exited).toBe(0);
      const files = readdirSync(outDir);
      expect(files.length).toBe(2); // All shared modules merged into one entry
    });

    test("partial sharing pattern", async () => {
      const dir = tempDirWithFiles("rolldown-test4", {
        "entry-a.js": `
          import { shared } from "./shared.js";
          import { onlyA } from "./only-a.js";
          export const a = shared + onlyA;
        `,
        "entry-b.js": `
          import { shared } from "./shared.js";
          import { onlyB } from "./only-b.js";
          export const b = shared + onlyB;
        `,
        "entry-c.js": `
          import { onlyC } from "./only-c.js";
          export const c = onlyC;
        `,
        "shared.js": `export const shared = "shared";`,
        "only-a.js": `export const onlyA = "only-a";`,
        "only-b.js": `export const onlyB = "only-b";`,
        "only-c.js": `export const onlyC = "only-c";`,
      });

      const outDir = join(dir, "out");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "entry-a.js",
          "entry-b.js",
          "entry-c.js",
          "--outdir",
          outDir,
          "--splitting",
          "--preserve-entry-signatures=allow-extension",
        ],
        env: bunEnv,
        cwd: dir,
      });

      expect(await proc.exited).toBe(0);
      const files = readdirSync(outDir);
      expect(files.length).toBe(3); // Each entry has its unique module

      // Verify shared module is in one of entry-a or entry-b
      const entryA = readFileSync(join(outDir, "entry-a.js"), "utf-8");
      const entryB = readFileSync(join(outDir, "entry-b.js"), "utf-8");
      const entryC = readFileSync(join(outDir, "entry-c.js"), "utf-8");

      const sharedInA = entryA.includes('shared = "shared"');
      const sharedInB = entryB.includes('shared = "shared"');
      const sharedInC = entryC.includes('shared = "shared"');

      expect(sharedInC).toBe(false); // C doesn't use shared
      expect(sharedInA !== sharedInB).toBe(true); // Exactly one of A or B has it
    });

    test("complex sharing with three entries", async () => {
      const dir = tempDirWithFiles("rolldown-test5", {
        "entry-a.js": `
          import { ab } from "./ab.js";
          import { abc } from "./abc.js";
          export const a = ab + abc;
        `,
        "entry-b.js": `
          import { ab } from "./ab.js";
          import { bc } from "./bc.js";
          import { abc } from "./abc.js";
          export const b = ab + bc + abc;
        `,
        "entry-c.js": `
          import { bc } from "./bc.js";
          import { abc } from "./abc.js";
          export const c = bc + abc;
        `,
        "ab.js": `export const ab = "shared-by-ab";`,
        "bc.js": `export const bc = "shared-by-bc";`,
        "abc.js": `export const abc = "shared-by-all";`,
      });

      const outDir = join(dir, "out");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "entry-a.js",
          "entry-b.js",
          "entry-c.js",
          "--outdir",
          outDir,
          "--splitting",
          "--preserve-entry-signatures=allow-extension",
        ],
        env: bunEnv,
        cwd: dir,
      });

      expect(await proc.exited).toBe(0);
      const files = readdirSync(outDir);

      // With optimization, shared modules should be consolidated
      expect(files.length).toBeLessThan(6); // Less than 3 entries + 3 shared
      expect(files).toContain("entry-a.js");
      expect(files).toContain("entry-b.js");
      expect(files).toContain("entry-c.js");

      // Count how many files contain each shared module
      let abCount = 0,
        bcCount = 0,
        abcCount = 0;
      for (const file of files) {
        const content = readFileSync(join(outDir, file), "utf-8");
        if (content.includes("shared-by-ab")) abCount++;
        if (content.includes("shared-by-bc")) bcCount++;
        if (content.includes("shared-by-all")) abcCount++;
      }

      // Each shared module should appear exactly once
      expect(abCount).toBe(1);
      expect(bcCount).toBe(1);
      expect(abcCount).toBe(1);
    });

    test("preserveEntrySignatures options", async () => {
      const createTest = async (mode: string) => {
        const dir = tempDirWithFiles(`rolldown-test-${mode}`, {
          "entry.js": `
            import { util } from "./util.js";
            export default util;
          `,
          "other.js": `
            import { util } from "./util.js";
            export const other = util;
          `,
          "util.js": `export const util = "util";`,
        });

        const outDir = join(dir, "out");
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "entry.js",
            "other.js",
            "--outdir",
            outDir,
            "--splitting",
            `--preserve-entry-signatures=${mode}`,
          ],
          env: bunEnv,
          cwd: dir,
        });

        expect(await proc.exited).toBe(0);
        return readdirSync(outDir).length;
      };

      const strictCount = await createTest("strict");
      const allowCount = await createTest("allow-extension");
      const exportsCount = await createTest("exports-only");
      const falseCount = await createTest("false");

      // Strict should create the most chunks (no optimization)
      expect(strictCount).toBe(3);
      // Others should create fewer chunks (optimization enabled)
      expect(allowCount).toBe(2);
      expect(exportsCount).toBe(2);
      expect(falseCount).toBe(2);
    });
  });
});
