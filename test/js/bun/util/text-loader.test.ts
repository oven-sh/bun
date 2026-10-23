import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, isLinux } from "harness";
import { join } from "path";

describe("text-loader", () => {
  const fixtures = [
    ["dynamic-import reloaded 10000 times", "text-loader-fixture-dynamic-import-stress.ts"],
    ["dynamic-import", "text-loader-fixture-dynamic-import.ts"],
    ["import", "text-loader-fixture-import.ts"],
    ["require", "text-loader-fixture-require.ts"],
  ] as const;
  for (let [kind, path] of fixtures) {
    describe("should load text", () => {
      it(`using ${kind}`, () => {
        const result = spawnSync({
          cmd: [bunExe(), join(import.meta.dir, path)],
          env: bunEnv,
          stdout: "pipe",
          stderr: "inherit",
          stdin: "ignore",
        });

        if (result.exitCode !== 0) {
          console.log({ result });
        }

        expect(result.stdout.toString()).toBe("These are words!");
        expect(result.exitCode).toBe(0);
      });
    });
  }

  for (let [entry, path] of [
    // https://github.com/oven-sh/bun/issues/10206
    ["text-loader-fixture-import-nonascii.ts", "text-loader-fixture-text-file.nonascii.txt"],
    ["text-loader-fixture-import-latin1.ts", "text-loader-fixture-text-file.latin1.txt"],
    // https://github.com/oven-sh/bun/issues/3449
    ["text-loader-fixture-import-backslashes.ts", "text-loader-fixture-text-file.backslashes.txt"],
  ]) {
    describe("should load non-ASCII text", () => {
      it(`${entry}`, async () => {
        const src = join(import.meta.dir, entry);
        const result = spawnSync({
          cmd: [bunExe(), src],
          env: bunEnv,
          stdout: "pipe",
          stderr: "inherit",
          stdin: "ignore",
        });

        if (result.exitCode !== 0) {
          console.log({ result });
        }

        const absolute = join(import.meta.dir, path);

        const expected = readFileSync(absolute, "utf8");
        const source = readFileSync(src, "utf8");
        expect(result.stdout.toString()).toBe(expected);

        // Also test that `type: "text"` has higher precedence than the file extension.
        expect((await import(src, { with: { type: "text" } })).default).toBe(source);

        expect(result.exitCode).toBe(0);
      });
    });
  }

  async function runChild(script: string, env: Record<string, string | undefined> = bunEnv) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // A procfs file is a regular file with st_size 0 and content. The loader
  // probes the first 16 KiB without a stat. When the probe fills, st_size 0
  // is not the length of the file and the loader must read to EOF. The child
  // imports its own /proc/self/environ, which a 100 KB variable makes larger.
  it.skipIf(!isLinux)("loads a procfs file larger than the 16 KiB probe", async () => {
    const { stdout, stderr, exitCode } = await runChild(
      `const path = "/proc/self/environ";
       const stat = require("fs").statSync(path).size;
       const expected = require("fs").readFileSync(path, "utf8");
       const imported = (await import(path, { with: { type: "text" } })).default;
       console.log(JSON.stringify({ stat, expected: expected.length, imported: imported.length, same: imported === expected }));`,
      { ...bunEnv, BIG_ENV_VALUE: Buffer.alloc(100_000, "x").toString() },
    );
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result.expected).toBeGreaterThan(100_000);
    expect(result).toEqual({ stat: 0, expected: result.expected, imported: result.expected, same: true });
    expect(exitCode).toBe(0);
  });

  // /proc/self/pagemap is a regular file with st_size 0 that yields hundreds
  // of GB. The read stops at the max string length, which the child lowers.
  it.skipIf(!isLinux || !existsSync("/proc/self/pagemap"))(
    "fails to load a procfs file with no practical end",
    async () => {
      // A debug build also prints the read error to stderr.
      const { stdout, exitCode } = await runChild(
        `require("bun:internal-for-testing").setSyntheticAllocationLimitForTesting(1024 * 1024);
         try {
           const imported = (await import("/proc/self/pagemap", { with: { type: "text" } })).default;
           console.log(JSON.stringify({ imported: imported.length }));
         } catch (e) {
           console.log(JSON.stringify({ threw: String(e?.message ?? e) }));
         }`,
      );
      expect(JSON.parse(stdout)).toEqual({ threw: expect.stringContaining("ENOMEM") });
      expect(exitCode).toBe(0);
    },
  );
});
