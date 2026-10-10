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

  // node:sys is another name of node:util.
  test.concurrent.each(["--preload", "--import", "--require"])("%s of a builtin by an alias", async flag => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), flag, "node:sys", "-e", "console.log('main ran')"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "main ran\n", stderr: "", exitCode: 0 });
  });

  // As with `node -r path` and `node --import path`, a builtin's bare name is the builtin. The resolver would
  // take it for a package: the one in node_modules, or one to fetch from the registry.
  describe.each(["--preload", "--import", "--require", "bunfig.toml"])("%s of a builtin by its bare name", how => {
    const preloads = ["path", "fs/promises", "bun:sqlite", "ws"];
    const cmd =
      how === "bunfig.toml" ? [bunExe(), "main.js"] : [bunExe(), ...preloads.flatMap(name => [how, name]), "main.js"];
    const files = {
      "main.js": `console.log("main ran");`,
      ...(how === "bunfig.toml" ? { "bunfig.toml": `preload = ${JSON.stringify(preloads)}` } : {}),
    };

    async function run(cwd) {
      const requests = [];
      await using registry = Bun.serve({
        port: 0,
        fetch(req) {
          requests.push(new URL(req.url).pathname);
          return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
        },
      });
      await using proc = Bun.spawn({
        cmd,
        env: { ...bunEnv, BUN_CONFIG_REGISTRY: registry.url.href, NPM_CONFIG_REGISTRY: registry.url.href },
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode, requests };
    }

    test.concurrent("does not run the package of that name in node_modules", async () => {
      const packages = {};
      for (const name of ["path", "fs", "ws"]) {
        packages[`node_modules/${name}/package.json`] = JSON.stringify({ name, version: "1.0.0", main: "index.js" });
        packages[`node_modules/${name}/index.js`] = `console.log("node_modules/${name} ran");`;
      }
      packages["node_modules/fs/promises.js"] = `console.log("node_modules/fs/promises.js ran");`;
      using dir = tempDir("preload-builtin-name-node-modules", { ...files, ...packages });
      expect(await run(String(dir))).toEqual({ stdout: "main ran\n", stderr: "", exitCode: 0, requests: [] });
    });

    test.concurrent("does not ask the registry for a package of that name", async () => {
      using dir = tempDir("preload-builtin-name-autoinstall", files);
      expect(await run(String(dir))).toEqual({ stdout: "main ran\n", stderr: "", exitCode: 0, requests: [] });
    });
  });

  // Under `--expose-internals` an `internal/` module is a builtin too, and `internal` is a package's name.
  test("--preload of an internal/ module under --expose-internals", async () => {
    using dir = tempDir("preload-builtin-name-expose-internals", {
      "node_modules/internal/package.json": JSON.stringify({ name: "internal", version: "1.0.0" }),
      "node_modules/internal/validators.js": `console.log("node_modules/internal/validators.js ran");`,
      "main.js": `console.log("main ran");`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--expose-internals", "--preload", "internal/validators", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "main ran\n", stderr: "", exitCode: 0 });
  });

  // The `preload` option of a Worker names its modules the same way.
  test("Worker preload of a builtin by its bare name does not run the package of that name in node_modules", async () => {
    const packages = {};
    for (const name of ["path", "ws"]) {
      packages[`node_modules/${name}/package.json`] = JSON.stringify({ name, version: "1.0.0", main: "index.js" });
      packages[`node_modules/${name}/index.js`] = `console.log("node_modules/${name} ran");`;
    }
    using dir = tempDir("preload-builtin-name-worker", {
      ...packages,
      "worker.js": `postMessage("worker ran");`,
      "main.js": `
        const worker = new Worker("./worker.js", { preload: ["path", "bun:sqlite", "ws"] });
        worker.onmessage = e => {
          console.log(e.data);
          worker.terminate();
        };
        worker.onerror = e => {
          console.log("error: " + e.message);
        };
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "worker ran\n", stderr: "", exitCode: 0 });
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
