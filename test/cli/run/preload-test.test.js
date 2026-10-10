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

  // A debug build takes about a second to start. Several at once pass the test timeout.
  const concurrentTest = test.concurrentIf(!isDebug);

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
      // Reads the stream as it comes. The function it returns gives all that was read, once that
      // has `expected` (a string or a RegExp) in it or the stream has ended.
      const collect = stream => {
        let text = "";
        let ended = false;
        let more = Promise.withResolvers();
        (async () => {
          const decoder = new TextDecoder();
          try {
            for await (const chunk of stream) {
              text += decoder.decode(chunk, { stream: true });
              more.resolve();
              more = Promise.withResolvers();
            }
          } finally {
            ended = true;
            more.resolve();
          }
        })();
        return async expected => {
          const found = () => (typeof expected === "string" ? text.includes(expected) : expected.test(text));
          while (!found() && !ended) await more.promise;
          return text;
        };
      };
      return {
        stdout: collect(proc.stdout),
        stderr: collect(proc.stderr),
        write: (name, contents) => writeFileSync(join(String(dir), name), contents),
        remove: name => rmSync(join(String(dir), name)),
        async [Symbol.asyncDispose]() {
          proc.kill();
          await proc.exited;
          dir[Symbol.dispose]();
        },
      };
    }

    concurrentTest("a reload that lands while the preloads load waits for them", async () => {
      // It saves a watched file, itself, while it evaluates. The watcher logs a change (logLevel)
      // just before it posts the reload for it, so the log line does not say that the reload is
      // posted. The preload then saves a second file: the watcher gets to that change, and logs
      // it, only after it has posted the first reload. The preload goes on from there.
      const first = `
        if (!globalThis.savedOnce) {
          globalThis.savedOnce = true;
          const fs = require("node:fs");
          const helper = require.resolve("./helper.js");
          require(helper);
          fs.writeFileSync(__filename, fs.readFileSync(__filename));
          while (!fs.existsSync(__dirname + "/first-logged")) {}
          fs.writeFileSync(helper, fs.readFileSync(helper));
          while (!fs.existsSync(__dirname + "/helper-logged")) {}
        }
        console.log("first ran");
      `;
      await using hot = spawnHot({
        "bunfig.toml": `logLevel = "debug"`,
        "first.js": first,
        "helper.js": `// A module of first.js.`,
        "second.js": `console.log("second ran");`,
      });
      expect(await hot.stderr(/watcher: .*first\.js/)).toMatch(/watcher: .*first\.js/);
      hot.write("first-logged", "");
      expect(await hot.stderr(/watcher: .*helper\.js/)).toMatch(/watcher: .*helper\.js/);
      hot.write("helper-logged", "");
      // The preloads ran once and in order. The reload came after them: they are not run again.
      expect(await hot.stdout("main ran\nmain ran\n")).toStartWith("first ran\nsecond ran\nmain ran\nmain ran\n");
      hot.write("main.js", `console.log("main ran again");`);
      expect(await hot.stdout("main ran again\n")).toContain("main ran again\n");
    });

    concurrentTest("a preload that is gone on a reload is reported, and the next reload runs", async () => {
      // A preload that failed keeps the list of preloads, and a reload runs them again.
      await using hot = spawnHot({
        "first.js": `throw new Error("from first.js");`,
        "second.js": `console.log("second ran");`,
      });
      expect(await hot.stderr("error: from first.js")).toContain("error: from first.js");
      hot.remove("first.js");
      hot.write("main.js", `console.log("main ran");`);
      expect(await hot.stderr('preload not found "./first.js"')).toContain('preload not found "./first.js"');
      hot.write("first.js", `console.log("first ran");`);
      hot.write("main.js", `console.log("main ran");`);
      expect(await hot.stdout("main ran\n")).toContain("first ran\nsecond ran\nmain ran\n");
      // The error of the load before is not reported again.
      expect((await hot.stderr("")).split("error: from first.js")).toHaveLength(2);
    });
  });
});
