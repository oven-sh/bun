import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";
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
        build.onLoad({ namespace: "boop", filter: /.*/ }, async (args) => {
            return {
                contents: '"hello world"',
                loader: 'json'
            }
        });
    }
});
    `;

const mainModule = `import hey from './hey.txt';

if (hey !== 'hello world') {
    throw new Error('preload test failed, got ' + hey);
}

console.log('Test passed');
process.exit(0);
`;

const bunfig = `preload = ["./preload.js"]`;

describe("preload", () => {
  test.todo("works", async () => {
    const preloadDir = join(realpathSync(tmpdir()), "bun-preload-test");
    mkdirSync(preloadDir, { recursive: true });
    const preloadPath = join(preloadDir, "preload.js");
    const mainPath = join(preloadDir, "main.js");
    const bunfigPath = join(preloadDir, "bunfig.toml");
    await Bun.write(preloadPath, preloadModule);
    await Bun.write(mainPath, mainModule);
    await Bun.write(bunfigPath, bunfig);

    const cmds = [
      [bunExe(), "run", mainPath],
      [bunExe(), mainPath],
    ];

    for (let cmd of cmds) {
      const { stderr, exitCode, stdout } = spawnSync({
        cmd,
        cwd: preloadDir,
        stderr: "pipe",
        stdout: "pipe",
        env: bunEnv,
      });

      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("Test passed");
      expect(exitCode).toBe(0);
    }
  });

  test.todo("works from CLI", async () => {
    const preloadDir = join(realpathSync(tmpdir()), "bun-preload-test4");
    mkdirSync(preloadDir, { recursive: true });
    const preloadPath = join(preloadDir, "preload.js");
    const mainPath = join(preloadDir, "main.js");
    await Bun.write(preloadPath, preloadModule);
    await Bun.write(mainPath, mainModule);

    const cmds = [
      [bunExe(), "-r=" + preloadPath, "run", mainPath],
      [bunExe(), "-r=" + preloadPath, mainPath],
    ];

    for (let cmd of cmds) {
      const { stderr, exitCode, stdout } = spawnSync({
        cmd,
        cwd: preloadDir,
        stderr: "pipe",
        stdout: "pipe",
        env: bunEnv,
      });

      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("Test passed");
      expect(exitCode).toBe(0);
    }
  });

  describe("as entry point", () => {
    const preloadModule = `
import {plugin} from 'bun';
console.log('preload')
plugin({
    setup(build) {
        build.onResolve({ filter: /.*\.txt$/, }, async (args) => {
            return {
                path: args.path,
                namespace: 'boop'
            }
        });
        build.onLoad({ namespace: "boop", filter: /.*/ }, async (args) => {
            return {
                contents: 'console.log("Test passed")',
                loader: 'js'
            }
        });
    }
});
    `;

    test.todo("works from CLI", async () => {
      const preloadDir = join(realpathSync(tmpdir()), "bun-preload-test6");
      mkdirSync(preloadDir, { recursive: true });
      const preloadPath = join(preloadDir, "preload.js");
      const mainPath = join(preloadDir, "boop.txt");
      await Bun.write(preloadPath, preloadModule);
      await Bun.write(mainPath, "beep");

      const cmds = [
        [bunExe(), "-r=" + preloadPath, "run", mainPath],
        [bunExe(), "-r=" + preloadPath, mainPath],
      ];

      for (let cmd of cmds) {
        const { stderr, exitCode, stdout } = spawnSync({
          cmd,
          cwd: preloadDir,
          stderr: "pipe",
          stdout: "pipe",
          env: bunEnv,
        });

        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toContain("Test passed");
        expect(exitCode).toBe(0);
      }
    });
  });

  test("throws an error when preloaded module fails to execute", async () => {
    const preloadModule = "throw new Error('preload test failed');";

    const preloadDir = join(realpathSync(tmpdir()), "bun-preload-test3");
    mkdirSync(preloadDir, { recursive: true });
    const preloadPath = join(preloadDir, "preload.js");
    const mainPath = join(preloadDir, "main.js");
    const bunfigPath = join(preloadDir, "bunfig.toml");
    await Bun.write(preloadPath, preloadModule);
    await Bun.write(mainPath, mainModule);
    await Bun.write(bunfigPath, bunfig);

    const cmds = [
      [bunExe(), "run", mainPath],
      [bunExe(), mainPath],
    ];

    for (let cmd of cmds) {
      const { stderr, exitCode, stdout } = spawnSync({
        cmd,
        cwd: preloadDir,
        stderr: "pipe",
        stdout: "pipe",
        env: bunEnv,
      });

      expect(stderr.toString()).toContain("preload test failed");
      expect(stdout.toString()).toBe("");
      expect(exitCode).toBe(1);
    }
  });

  test("throws an error when preloaded module not found", async () => {
    const bunfig = `preload = ["./bad-file.js"]`;

    const preloadDir = join(realpathSync(tmpdir()), "bun-preload-test2");
    mkdirSync(preloadDir, { recursive: true });
    const preloadPath = join(preloadDir, "preload.js");
    const mainPath = join(preloadDir, "main.js");
    const bunfigPath = join(preloadDir, "bunfig.toml");
    await Bun.write(preloadPath, preloadModule);
    await Bun.write(mainPath, mainModule);
    await Bun.write(bunfigPath, bunfig);

    const cmds = [
      [bunExe(), "run", mainPath],
      [bunExe(), mainPath],
    ];

    for (let cmd of cmds) {
      const { stderr, exitCode, stdout } = spawnSync({
        cmd,
        cwd: preloadDir,
        stderr: "pipe",
        stdout: "pipe",
        env: bunEnv,
      });

      expect(stderr.toString()).toContain("preload not found ");
      expect(stdout.toString()).toBe("");
      expect(exitCode).toBe(1);
    }
  });
});

// https://github.com/oven-sh/bun/issues/34226
describe("preload export conditions", () => {
  test.concurrent.each([
    ["--require", "require"],
    ["--import", "import"],
    ["--preload", "import"],
  ])("%s resolves dual package exports with the '%s' condition", async (flag, expected) => {
    using dir = tempDir("preload-conditions", {
      "main.js": `console.log("main");`,
      "node_modules/dual-preload/package.json": JSON.stringify({
        name: "dual-preload",
        version: "1.0.0",
        type: "module",
        exports: {
          ".": {
            import: "./import.js",
            require: "./require.cjs",
          },
        },
      }),
      "node_modules/dual-preload/import.js": `console.log("import");`,
      "node_modules/dual-preload/require.cjs": `console.log("require");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), flag, "dual-preload", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect({ stdout, exitCode, stderr: stderr.includes("error") ? stderr : "" }).toEqual({
      stdout: `${expected}\nmain\n`,
      exitCode: 0,
      stderr: "",
    });
  });
});
