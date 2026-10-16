import { spawnSync } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
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

  // A preload: Module.runMain answers a promise whose "constructor" getter throws. The load of the
  // entry point reads that getter.
  const runMainAnswerThrows = `
    require("node:module").runMain = () => {
      const promise = Promise.resolve();
      Object.defineProperty(promise, "constructor", { get() { throw new Error("from the getter"); } });
      return promise;
    };
  `;

  describe("with --hot", () => {
    // A test that times out does not get to the end of its body, where its child is killed.
    const children = new Set();
    afterAll(() => {
      for (const proc of children) proc.kill();
    });

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
      children.add(proc);
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
      const path = name => join(String(dir), name);
      return {
        stdout: collect(proc.stdout),
        stderr: collect(proc.stderr),
        write: (name, contents) => writeFileSync(path(name), contents),
        // The file is never there empty, as it is for a moment in a write.
        create(name, contents) {
          writeFileSync(path(name + ".new"), contents);
          renameSync(path(name + ".new"), path(name));
        },
        remove: name => rmSync(path(name)),
        async [Symbol.asyncDispose]() {
          proc.kill();
          await proc.exited;
          children.delete(proc);
          dir[Symbol.dispose]();
        },
      };
    }

    // For a preload that holds its load until the test has made a file. It gives up after a
    // minute, so that it does not outlive a test that timed out.
    const waitFor = `
      const waitFor = name => {
        const deadline = Date.now() + 60_000;
        while (!require("node:fs").existsSync(__dirname + "/" + name)) {
          if (Date.now() > deadline) process.exit(3);
          Bun.sleepSync(1);
        }
      };
    `;

    // A preload holds its load until the reload for a save is posted. `save` is code of the
    // preload that saves a watched file. If it is empty, the test saves one. The watcher logs a
    // change (logLevel) just before it posts the reload for it, so that line does not say that the
    // reload is posted. The preload then saves a second file: the watcher gets to that change,
    // and logs it, only after it has posted the first reload.
    const hold = (save = "") => `
      ${waitFor}
      {
        const fs = require("node:fs");
        const helper = require.resolve("./helper.js");
        require(helper);
        ${save}
        waitFor("saved");
        fs.writeFileSync(helper, fs.readFileSync(helper));
        waitFor("helper-saved");
      }
    `;
    async function posted(hot, file) {
      const saved = new RegExp("watcher: .*" + file.replace(".", "\\."));
      expect(await hot.stderr(saved)).toMatch(saved);
      hot.write("saved", "");
      expect(await hot.stderr(/watcher: .*helper\.js/)).toMatch(/watcher: .*helper\.js/);
      hot.write("helper-saved", "");
    }
    const held = { "bunfig.toml": `logLevel = "debug"`, "helper.js": `// A module of the preload that holds.` };

    concurrentTest("a reload that lands while the preloads load waits for them", async () => {
      const first = `
        if (!globalThis.savedOnce) {
          globalThis.savedOnce = true;
          ${hold("fs.writeFileSync(__filename, fs.readFileSync(__filename));")}
        }
        console.log("first ran");
      `;
      await using hot = spawnHot({ ...held, "first.js": first, "second.js": `console.log("second ran");` });
      await posted(hot, "first.js");
      // The preloads ran once and in order. The reload came after them: they are not run again.
      expect(await hot.stdout("main ran\nmain ran\n")).toStartWith("first ran\nsecond ran\nmain ran\nmain ran\n");
      hot.write("main.js", `console.log("main ran again");`);
      expect(await hot.stdout("main ran again\n")).toContain("main ran again\n");
    });

    // A preload that failed keeps the list of preloads, and each reload loads them again.
    const failsOnce = `
      if (!globalThis.failedOnce) {
        globalThis.failedOnce = true;
        throw new Error("from second.js");
      }
    `;

    concurrentTest("a reload that lands while the preloads of a reload load runs them again", async () => {
      // In the reload, second.js holds its load while the test saves first.js, which was read before.
      const second = `
        ${failsOnce}
        if (!globalThis.heldOnce) {
          globalThis.heldOnce = true;
          console.log("second holds");
          ${hold()}
        }
        console.log("second ran");
      `;
      const first = text => `console.log("first ran: ${text}");`;
      await using hot = spawnHot({ ...held, "first.js": first("old"), "second.js": second });
      expect(await hot.stderr("error: from second.js")).toContain("error: from second.js");
      hot.write("main.js", `console.log("main ran");`);
      expect(await hot.stdout("second holds\n")).toBe("first ran: old\nfirst ran: old\nsecond holds\n");
      hot.write("first.js", first("new"));
      await posted(hot, "first.js");
      const again = "first ran: new\nsecond ran\nmain ran\n";
      // Or the entry point ran twice, with no preload in between.
      expect(await hot.stdout(new RegExp(again + "|main ran\n[^]*main ran\n"))).toContain(again);
    });

    concurrentTest("a preload that is gone on a reload is reported, and the next reload runs", async () => {
      await using hot = spawnHot({
        "first.js": `throw new Error("from first.js");`,
        "second.js": `console.log("second ran");`,
      });
      expect(await hot.stderr("error: from first.js")).toContain("error: from first.js");
      hot.remove("first.js");
      hot.write("main.js", `console.log("main ran");`);
      expect(await hot.stderr('preload not found "./first.js"')).toContain('preload not found "./first.js"');
      hot.create("first.js", `console.log("first ran");`);
      hot.write("main.js", `console.log("main ran"); console.error("main done");`);
      expect(await hot.stdout("main ran\n")).toContain("first ran\nsecond ran\nmain ran\n");
      // stderr is in order: all that the loads before reported is in front of the line of main.js.
      const stderr = await hot.stderr("main done");
      expect(stderr).toContain("main done");
      // The error of the first load is not reported again.
      expect(stderr.split("error: from first.js")).toHaveLength(2);
    });

    concurrentTest("a reload that fails reports what it logged, and not what an earlier reload logged", async () => {
      const first = text => `throw new Error("from first.js, ${text}");`;
      await using hot = spawnHot({
        "tsconfig.json": `{}`,
        "first.js": first("one"),
        "second.js": `console.log("second ran");`,
      });
      expect(await hot.stderr("error: from first.js, one")).toContain("error: from first.js, one");
      // The first load prints what is logged until it has reported its error. After the error of a
      // reload, that is over.
      hot.write("first.js", first("two"));
      expect(await hot.stderr("error: from first.js, two")).toContain("error: from first.js, two");
      // This reload logs a warning about tsconfig.json, and nothing prints it.
      hot.write("tsconfig.json", `{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }`);
      hot.write("first.js", first("three"));
      expect(await hot.stderr("error: from first.js, three")).toContain("error: from first.js, three");
      hot.write("tsconfig.json", `{}`);
      hot.remove("first.js");
      hot.write("main.js", `console.log("main ran");`);
      const stderr = await hot.stderr('preload not found "./first.js"');
      expect(stderr).toContain('preload not found "./first.js"');
      expect(stderr).not.toContain("tsconfig.json");
    });

    concurrentTest("a reload that throws before it has a promise is reported, and the next reload runs", async () => {
      await using hot = spawnHot({ "first.js": runMainAnswerThrows, "second.js": failsOnce });
      expect(await hot.stderr("error: from second.js")).toContain("error: from second.js");
      hot.write("main.js", `console.log("main ran");`);
      expect(await hot.stderr("error: from the getter")).toContain("error: from the getter");
      hot.write("main.js", `console.log("main ran again");`);
      expect(await hot.stdout("main ran again\n")).toContain("main ran again\n");
    });
  });
});
