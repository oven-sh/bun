import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { bunEnv, bunExe } from "harness";

const preloadModule = `
import {plugin} from 'bun';

plugin({
    setup(build) {
        build.onResolve({ filter: /.*\.txt$/, }, async (args) => {
            return {
                path: args.path,
                namespace: 'boop'
            }
        });
        build.onResolve({ namespace: "boop", filter: /.*/ }, async (args) => {
            return {
                path: args.path,
                namespace: 'boop'
            }
        });
        build.onLoad({ namespace: "boop", filter: /.*/ }, async (args) => {
            return {
                contents: '"hello world"',
                loader: 'json'
            }
        });
    }
});
`;

const mainModule = `
import { expect, test } from 'bun:test';
import hey from './hey.txt';

test('says hello world', () => {
  expect(hey).toBe('hello world');
});
`;

const bunfig = `test.preload = ["./preload.js"]`;

describe("preload for bun:test", () => {
  test.todo("works with bunfig", async () => {
    const preloadDir = join(realpathSync(tmpdir()), "bun-test-preload-test1");
    mkdirSync(preloadDir, { recursive: true });
    const preloadPath = join(preloadDir, "preload.js");
    const mainPath = join(preloadDir, "main.test.js");
    const bunfigPath = join(preloadDir, "bunfig.toml");
    await Bun.write(preloadPath, preloadModule);
    await Bun.write(mainPath, mainModule);
    await Bun.write(bunfigPath, bunfig);

    const cmds = [[bunExe(), "test", mainPath]];

    for (let cmd of cmds) {
      const { stderr, exitCode, stdout } = spawnSync({
        cmd,
        cwd: preloadDir,
        stderr: "pipe",
        stdout: "pipe",
        env: bunEnv,
      });

      expect(exitCode).toBe(0);
      const str = stderr.toString();
      expect(str).toContain("✓ says hello world");
      expect(str).toContain("1 pass");
      expect(str).toContain("0 fail");
    }
  });

  test.todo("works from CLI", async () => {
    const preloadDir = join(realpathSync(tmpdir()), "bun-test-preload-test2");
    mkdirSync(preloadDir, { recursive: true });
    const preloadPath = join(preloadDir, "preload.js");
    const mainPath = join(preloadDir, "main.test.js");
    await Bun.write(preloadPath, preloadModule);
    await Bun.write(mainPath, mainModule);

    const cmds = [[bunExe(), `-r=${preloadPath}`, "test", mainPath]];

    for (let cmd of cmds) {
      const { stderr, exitCode, stdout } = spawnSync({
        cmd,
        cwd: preloadDir,
        stderr: "pipe",
        stdout: "pipe",
        env: bunEnv,
      });

      expect(exitCode).toBe(0);
      const str = stderr.toString();
      expect(str).toContain("✓ says hello world");
      expect(str).toContain("1 pass");
      expect(str).toContain("0 fail");
    }
  });
});
