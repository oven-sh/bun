import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
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

  // procfs files are regular files whose st_size is 0. The loader probes the
  // first 16 KiB without a stat. When the probe fills, the stat size is not
  // the length of the file and the loader must read to EOF.
  it.skipIf(!isLinux)("loads a procfs file larger than the 16 KiB probe", async () => {
    const path = "/proc/self/environ";
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const p = ${JSON.stringify(path)};
         const stat = require("fs").statSync(p).size;
         const expected = require("fs").readFileSync(p, "latin1");
         const imported = (await import(p, { with: { type: "text" } })).default;
         console.log(JSON.stringify({ stat, expected: expected.length, imported: imported.length, same: imported === expected }));`,
      ],
      env: { ...bunEnv, BIG_ENV_VALUE: Buffer.alloc(100_000, "x").toString() },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result.expected).toBeGreaterThan(100_000);
    expect(result).toEqual({ stat: 0, expected: result.expected, imported: result.expected, same: true });
    expect(exitCode).toBe(0);
  });
});
