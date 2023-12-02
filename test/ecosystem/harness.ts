import { spawnSync, Glob } from "bun";
import { join, resolve } from "node:path";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

export type TestOptions = {
  package: string;
  repository: string;
  ref: string | null;
  paths: string[];
  runner: "jest" | "vitest" | "ava" | "mocha" | "qunit" | "tap" | "utest" | "uvu" | "script";
  skip?: boolean | string;
  todo?: boolean | string;
  cmds?: string[][];
};

export function runTests({ package: name, repository, ref, paths, runner, skip, todo, cmds }: TestOptions): void {
  if (todo) {
    test.todo(name, () => {});
    return;
  } else if (skip) {
    test.skip(name, () => {});
    return;
  }

  describe(name, () => {
    const run = import(join(import.meta.dir, "runner", `${runner}.js`));
    const tmp = mkdtempSync(join(tmpdir(), `${name.replace(/\//g, "-")}-`));
    const cwd = join(tmp, "node_modules", name);

    {
      const target = ref ? `${repository}#${ref}` : repository;
      const { exitCode } = spawnSync({
        cwd: tmp,
        cmd: [bunExe(), "install", target],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      if (exitCode !== 0) {
        throw `bun install ${target}`;
      }
    }

    {
      const { exitCode } = spawnSync({
        cwd,
        cmd: [bunExe(), "install"],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });

      if (exitCode !== 0) {
        throw "bun install";
      }
    }

    for (const cmd of cmds ?? []) {
      if (cmd[0] === "bun") {
        cmd[0] = bunExe();
      }
      const { exitCode } = spawnSync({
        cwd,
        cmd,
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });

      if (exitCode !== 0) {
        throw cmd.join(" ");
      }
    }

    for (const path of paths) {
      const tests = [...new Glob(path).scanSync({ cwd })];

      if (!tests.length) {
        throw `No tests found: ${path}`;
      }

      for (const test of tests) {
        const absolutePath = resolve(cwd, test);

        if (!test.includes(".test.") && !test.includes(".spec.")) {
          symlinkSync(absolutePath, absolutePath.replace(/\.(c|m)?(j|t)sx?$/, ".test.ts"));
        }

        describe(test, async () => {
          const runner = await run;
          await runner.run(absolutePath);
        });
      }
    }
  });
}
