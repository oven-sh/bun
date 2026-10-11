import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
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

  // A builtin's bare name is the builtin, as it is to `import` and to `node -r path`. The resolver would take it
  // for a package. "abort-controller" is a package that Bun replaces with a built-in module.
  describe("of a builtin by its bare name", () => {
    const builtins = ["path", "fs/promises", "bun:sqlite", "abort-controller", "events"];
    const packages = (...names) =>
      Object.fromEntries(
        names.flatMap(name => [
          [`node_modules/${name}/package.json`, JSON.stringify({ name, version: "1.0.0", main: "index.js" })],
          [`node_modules/${name}/index.js`, `console.log("node_modules/${name} ran");`],
        ]),
      );

    async function run(cwd, args) {
      const requests = [];
      await using registry = Bun.serve({
        port: 0,
        fetch(req) {
          requests.push(new URL(req.url).pathname);
          return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
        },
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args, "main.js"],
        env: {
          ...bunEnv,
          NODE_NO_WARNINGS: undefined,
          BUN_CONFIG_REGISTRY: registry.url.href,
          NPM_CONFIG_REGISTRY: registry.url.href,
        },
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode, requests };
    }

    test.each(["--preload", "--import", "--require", "bunfig.toml"])(
      "%s does not run a file that the resolver has for that name",
      async how => {
        using dir = tempDir("preload-builtin-name-resolver", {
          ...packages("path", "fs", "abort-controller", "lodashy"),
          "node_modules/fs/promises.js": `console.log("node_modules/fs/promises.js ran");`,
          "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "./src" } }),
          "src/events.js": `console.log("src/events.js ran");`,
          "setup.js": `console.log("setup.js ran");`,
          "main.js": `console.log("main ran");`,
        });
        // A package that is no builtin, and a file, are still the resolver's.
        const preloads = [...builtins, "lodashy", pathToFileURL(join(String(dir), "setup.js")).href];
        if (how === "bunfig.toml") {
          writeFileSync(join(String(dir), "bunfig.toml"), `preload = ${JSON.stringify(preloads)}`);
        }

        const args = how === "bunfig.toml" ? [] : preloads.flatMap(name => [how, name]);
        expect(await run(String(dir), args)).toEqual({
          stdout: "node_modules/lodashy ran\nsetup.js ran\nmain ran\n",
          stderr: "",
          exitCode: 0,
          requests: [],
        });
      },
    );

    test("--preload does not ask the registry for a package of that name", async () => {
      using dir = tempDir("preload-builtin-name-autoinstall", { "main.js": `console.log("main ran");` });
      const args = builtins.flatMap(name => ["--preload", name]);
      expect(await run(String(dir), args)).toEqual({ stdout: "main ran\n", stderr: "", exitCode: 0, requests: [] });
    });

    // The `preload` option of a Worker is "equivalent to passing the `--preload` CLI argument". Its resolver also
    // takes a bare name for a `./name` file. Only the builtin `_tls_wrap` warns when it loads: that shows the load.
    // It loads `node:tls`, which takes seconds in a debug build.
    test("Worker preload loads the builtin, not a file that the resolver has for that name", async () => {
      using dir = tempDir("preload-builtin-name-worker", {
        ...packages("path", "abort-controller", "_tls_wrap", "lodashy"),
        "util.ts": `console.log("util.ts ran");`,
        "worker.js": `postMessage("worker ran");`,
        "main.js": `
          const preload = ["path", "bun:sqlite", "abort-controller", "util", "_tls_wrap", "lodashy"];
          const worker = new Worker("./worker.js", { preload });
          worker.onmessage = e => {
            console.log(e.data);
            worker.terminate();
          };
          worker.onerror = e => {
            console.log("error: " + e.message);
          };
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), []);
      // "(node:<pid>) <warning>", then a hint that names the executable.
      const warnings = stderr
        .split("\n")
        .map(line => line.replace(/^\(node:\d+\) /, ""))
        .filter(line => line && !line.startsWith("(Use `"));
      expect({ stdout, warnings, exitCode }).toEqual({
        stdout: "node_modules/lodashy ran\nworker ran\n",
        warnings: ["[DEP0192] DeprecationWarning: The _tls_wrap module is deprecated. Use `node:tls` instead."],
        exitCode: 0,
      });
    }, 30_000);
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

  // The name as written decides. `file://node:fs` is no builtin's name, and no file.
  test("--preload of file://node:fs is not found", async () => {
    using dir = tempDir("preload-builtin-name-file-url", { "main.js": `console.log("main ran");` });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "file://node:fs", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: `error: preload not found "file://node:fs"\n`,
      exitCode: 1,
    });
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
