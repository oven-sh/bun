import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
});
