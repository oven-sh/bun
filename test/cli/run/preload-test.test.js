import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
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

  // A plugin for a first preload. What it answers about a later one, the module loader refuses.
  const refusingPlugin = `
    const { basename } = require("node:path");
    const { existsSync } = require("node:fs");
    const answers = {
      "throws.js": () => { throw new Error("from onResolve"); },
      "absent.js": () => ({ path: "/absent/from-onResolve.js" }),
      "invalid.js": () => ({ path: 123 }),
      "pending.js": async () => { await 0; },
      "second.js": () => { if (existsSync(__dirname + "/refuse")) throw new Error("from onResolve"); },
    };
    Bun.plugin({
      name: "refuse",
      setup(build) {
        build.onResolve({ filter: /[\\\\/](throws|absent|invalid|pending|second)\\.js$/ }, ({ path }) => {
          console.log("onResolve", basename(path));
          return answers[basename(path)]();
        });
        build.onLoad({ filter: /[\\\\/]unloadable\\.js$/ }, ({ path }) => {
          console.log("onLoad", basename(path));
          throw new Error("from onLoad");
        });
      },
    });
  `;

  // The module loader throws for a load before the load has a promise: the name does not resolve,
  // or a plugin's hook for it throws, answers what is not valid, or answers a promise still pending.
  describe("a preload the module loader refuses", () => {
    async function run(files, cmd, env = bunEnv) {
      using dir = tempDir("preload-refused", { "main.js": `console.log("main ran");`, ...files });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...cmd],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test.each(["--preload", "--import", "--require"])("%s of a builtin that does not exist", async flag => {
      const { stdout, stderr, exitCode } = await run({}, [
        flag,
        "node:does_not_exist",
        "-e",
        "console.log('main ran')",
      ]);
      expect(stderr).toContain("No such built-in module: node:does_not_exist");
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
    });

    test("a builtin that does not exist, from bunfig.toml", async () => {
      const { stdout, stderr, exitCode } = await run({ "bunfig.toml": `preload = ["node:does_not_exist"]` }, [
        "main.js",
      ]);
      expect(stderr).toContain("No such built-in module: node:does_not_exist");
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
    });

    // The hooks of an earlier preload are asked about a later one.
    test.each([
      ["onResolve throws", "throws.js", "onResolve throws.js\n", "error: from onResolve"],
      [
        "onResolve answers what is not there",
        "absent.js",
        "onResolve absent.js\n",
        "Cannot find module '/absent/from-onResolve.js'",
      ],
      [
        "onResolve answers what is not a path",
        "invalid.js",
        "onResolve invalid.js\n",
        `Expected "path" to be a string in onResolve plugin`,
      ],
      [
        "onResolve answers a promise that is still pending",
        "pending.js",
        "onResolve pending.js\n",
        "onResolve() doesn't support pending promises yet",
      ],
      ["onLoad throws", "unloadable.js", "onLoad unloadable.js\n", "error: from onLoad"],
    ])("a file about which a plugin's %s", async (_, preload, asked, error) => {
      const files = { "plugin.js": refusingPlugin, [preload]: `console.log("preload ran");` };
      const { stdout, stderr, exitCode } = await run(files, [
        "--preload",
        "./plugin.js",
        "--preload",
        "./" + preload,
        "main.js",
      ]);
      expect(stderr).toContain(error);
      // The plugin was asked once, and neither the preload nor the entry point ran.
      expect({ stdout, exitCode }).toEqual({ stdout: asked, exitCode: 1 });
    });

    test("goes to the uncaughtException handler of an earlier preload", async () => {
      const files = {
        "handler.js": `process.on("uncaughtException", (error, origin) => console.log(origin + ":", error.message));`,
      };
      expect(await run(files, ["--preload", "./handler.js", "--preload", "node:does_not_exist", "main.js"])).toEqual({
        stdout: "unhandledRejection: No such built-in module: node:does_not_exist\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.each([
      ["", [], 2, " 0 pass\n 2 fail\n 2 errors\nRan 2 tests across 2 files."],
      [" --isolate", ["--isolate"], 2, " 0 pass\n 2 fail\n 2 errors\nRan 2 tests across 2 files."],
      [" --parallel", ["--parallel=2"], 2, " 0 pass\n 2 fail\n 2 errors\nRan 2 tests across 2 files."],
      [" --bail", ["--bail"], 1, "\nBailed out after 1 failure\n"],
    ])("is the error of each file of bun test%s", async (_, flags, failed, summary) => {
      const files = {
        "a.test.js": `require("bun:test").test("a", () => {});`,
        "b.test.js": `require("bun:test").test("b", () => {});`,
      };
      const cmd = ["test", ...flags, "--preload", "node:does_not_exist", "./a.test.js", "./b.test.js"];
      const { stderr, exitCode } = await run(files, cmd);
      expect(stderr).toContain(summary);
      expect(stderr).not.toContain("worker crashed");
      expect(stderr.split("error: No such built-in module: node:does_not_exist\n")).toHaveLength(failed + 1);
      expect(exitCode).toBe(1);
    });

    test.each([
      ["a preload that is a builtin that does not exist", {}, ["node:does_not_exist"], "No such built-in module"],
      [
        // In bun test, a mock.module() factory runs when the module loader fetches "bun:main".
        "an entry point for which a preload's mock.module() factory throws",
        { "mock.js": `require("bun:test").mock.module("bun:main", () => { throw new Error("from the factory"); });` },
        ["mock.js"],
        "from the factory",
      ],
    ])("%s is the error of a Worker", async (_, files, preload, message) => {
      using dir = tempDir("preload-refused-worker", { "entry.js": `postMessage("entry ran");`, ...files });
      const worker = new Worker(join(String(dir), "entry.js"), {
        preload: preload.map(name => (name in files ? join(String(dir), name) : name)),
      });
      const events = [];
      const { promise, resolve } = Promise.withResolvers();
      worker.onmessage = event => events.push("message: " + event.data);
      worker.onerror = event => events.push(event.message.includes(message) ? "error: " + message : event.message);
      worker.addEventListener("close", () => {
        events.push("close");
        resolve();
      });
      await promise;
      expect(events).toEqual(["error: " + message, "close"]);
    });

    // BUN_DISABLE_TRANSPILER=1 loads an entry point by its name, with no "bun:main" in between.
    test("an entry point that does not resolve, loaded by its name, is the error of a Worker", async () => {
      const files = {
        "parent.js": `
          const worker = new Worker("data:nocomma");
          worker.onerror = event => console.log(event.message.includes("invalid data URL") ? "error: invalid data URL" : event.message);
          worker.addEventListener("close", event => console.log("close:", event.code));
        `,
      };
      expect(await run(files, ["parent.js"], { ...bunEnv, BUN_DISABLE_TRANSPILER: "1" })).toEqual({
        stdout: "error: invalid data URL\nclose: 1\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // A node:worker_threads Worker takes about four seconds to start on a debug build.
    describe.skipIf(isDebug)("of a node:worker_threads Worker", () => {
      const files = {
        "entry.js": `require("node:worker_threads").parentPort.postMessage("entry ran");`,
        "parent.js": `
          const worker = new (require("node:worker_threads").Worker)(__dirname + "/entry.js", { preload: ["node:does_not_exist"] });
          if (process.argv[2] === "listen") worker.on("error", error => console.log(error.message.trim()));
          worker.on("message", message => console.log("message:", message));
          worker.on("exit", code => console.log("exit:", code));
        `,
      };

      test("is its 'error' event", async () => {
        expect(await run(files, ["parent.js", "listen"])).toEqual({
          stdout: "error: No such built-in module: node:does_not_exist\nexit: 1\n",
          stderr: "",
          exitCode: 0,
        });
      });

      // As in Node.
      test("ends a parent that has no 'error' listener", async () => {
        const { stdout, stderr, exitCode } = await run(files, ["parent.js"]);
        expect(stderr).toContain("No such built-in module: node:does_not_exist");
        expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
      });
    });
  });

  describe("with --hot", () => {
    function spawnHot(files) {
      const dir = tempDir("preload-hot", { "main.js": `console.log("main ran");`, ...files });
      const cmd = [bunExe(), "--hot", "--no-clear-screen", "--preload", "./first.js", "--preload", "./second.js"];
      const proc = Bun.spawn({
        cmd: [...cmd, "main.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      // All that was read, once it has `expected` in it or the stream ends.
      const readUntil = stream => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let text = "";
        return async expected => {
          while (!text.includes(expected)) {
            const { value, done } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
          }
          return text;
        };
      };
      return {
        proc,
        stdout: readUntil(proc.stdout),
        stderr: readUntil(proc.stderr),
        write: (name, contents) => writeFileSync(join(String(dir), name), contents),
        remove: name => rmSync(join(String(dir), name)),
        async [Symbol.asyncDispose]() {
          proc.kill();
          await proc.exited;
          dir[Symbol.dispose]();
        },
      };
    }

    test("a reload that lands while the preloads load waits for them", async () => {
      // It saves a watched file, itself, while it evaluates. Nothing tells it that the watcher has
      // posted the reload, so it stays busy for a while: the reload then lands before second.js loads.
      const first = `
        if (!globalThis.savedOnce) {
          globalThis.savedOnce = true;
          const fs = require("node:fs");
          fs.writeFileSync(__filename, fs.readFileSync(__filename));
          Bun.sleepSync(300);
        }
        console.log("first ran");
      `;
      await using hot = spawnHot({ "first.js": first, "second.js": `console.log("second ran");` });
      // The preloads ran once and in order. The reload came after them: they are not run again.
      expect(await hot.stdout("main ran\nmain ran\n")).toStartWith("first ran\nsecond ran\nmain ran\nmain ran\n");
      hot.write("main.js", `console.log("main ran again");`);
      expect(await hot.stdout("main ran again\n")).toContain("main ran again\n");
    });

    test("a preload that is gone on a reload ends the run with the error", async () => {
      const first = `console.log("first ran");`;
      // A preload that failed keeps the list of preloads, and a reload runs them again.
      await using hot = spawnHot({ "first.js": first, "second.js": `throw new Error("from second.js");` });
      expect(await hot.stderr("error: from second.js")).toContain("error: from second.js");
      hot.remove("second.js");
      hot.write("first.js", first);
      const [stderr, exitCode] = await Promise.all([hot.stderr('preload not found "./second.js"'), hot.proc.exited]);
      expect(stderr).toContain('preload not found "./second.js"');
      expect({ exitCode, signalCode: hot.proc.signalCode }).toEqual({ exitCode: 1, signalCode: null });
    });

    test("a preload the module loader refuses is reported, and loads on a reload that does not refuse it", async () => {
      await using hot = spawnHot({
        "first.js": refusingPlugin,
        "second.js": `console.log("second ran");`,
        "refuse": "",
      });
      expect(await hot.stderr("error: from onResolve")).toContain("error: from onResolve");
      hot.remove("refuse");
      hot.write("first.js", refusingPlugin);
      expect(await hot.stdout("main ran\n")).toContain("second ran\nmain ran\n");
      hot.write("main.js", `console.log("main ran again");`);
      expect(await hot.stdout("main ran again\n")).toContain("main ran again\n");
    });

    test("a preload the module loader refuses on a reload is reported, and the run goes on", async () => {
      const second = `
        if (!globalThis.failedOnce) {
          globalThis.failedOnce = true;
          throw new Error("from second.js");
        }
        console.log("second ran");
      `;
      await using hot = spawnHot({ "first.js": refusingPlugin, "second.js": second });
      expect(await hot.stderr("error: from second.js")).toContain("error: from second.js");
      hot.write("refuse", "");
      hot.write("first.js", refusingPlugin);
      expect(await hot.stderr("error: from onResolve")).toContain("error: from onResolve");
      hot.remove("refuse");
      hot.write("first.js", refusingPlugin);
      expect(await hot.stdout("main ran\n")).toContain("second ran\nmain ran\n");
      hot.write("main.js", `console.log("main ran again");`);
      expect(await hot.stdout("main ran again\n")).toContain("main ran again\n");
    });
  });
});
