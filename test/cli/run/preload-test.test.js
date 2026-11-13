import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
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

  test("reports a preloaded node: module that doesn't exist", async () => {
    using dir = tempDir("preload-missing-builtin", { "main.js": `console.log("main ran");` });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "node:does_not_exist", "main.js"],
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: expect.stringContaining("error: No such built-in module: node:does_not_exist\n"),
      exitCode: 1,
    });
  });

  describe("of bun test, after the working directory changed", () => {
    async function runTests(dir, args, files) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...args, ...files],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test.each(["--isolate", "--isolate=modules"])("is found for the second run of a file with %s", async isolate => {
      using dir = tempDir("preload-test-chdir", {
        "elsewhere/keep.txt": "",
        // A preload of the same name in the other folder is not the one that the run names.
        "elsewhere/preload.ts": `console.log("LOG the other preload");`,
        "preload.ts": `console.log("LOG preload");`,
        "a.test.ts": `
          import { test } from "bun:test";
          import { basename, join } from "node:path";
          test("changes the working directory", () => {
            console.log("LOG test in", process.cwd() === import.meta.dir ? "the folder of the run" : basename(process.cwd()));
            process.chdir(join(import.meta.dir, "elsewhere"));
          });
        `,
      });
      const { stdout, stderr, exitCode } = await runTests(
        dir,
        [isolate, "--rerun-each=2", "--preload", "./preload.ts"],
        ["./a.test.ts"],
      );
      expect(stderr).toContain(" 2 pass");
      // The second run starts where the first one left the process.
      expect({ log: stdout.split(/\r?\n/).filter(line => line.startsWith("LOG ")), exitCode }).toEqual({
        log: ["LOG preload", "LOG test in the folder of the run", "LOG test in elsewhere"],
        exitCode: 0,
      });
    });

    test("is found for the next file after it threw", async () => {
      using dir = tempDir("preload-test-chdir-throws", {
        "elsewhere/keep.txt": "",
        // After a preload fails, the next file loads the preloads again.
        "preload.ts": `
          process.chdir(import.meta.dir + "/elsewhere");
          throw new Error("thrown by the preload");
        `,
        "a.test.ts": `import { test } from "bun:test"; test("a", () => {});`,
        "b.test.ts": `import { test } from "bun:test"; test("b", () => {});`,
      });
      const { stderr, exitCode } = await runTests(dir, ["--preload", "./preload.ts"], ["./a.test.ts", "./b.test.ts"]);
      expect({ errors: stderr.match(/^error: .*$/gm), exitCode }).toEqual({
        errors: ["error: thrown by the preload", "error: thrown by the preload"],
        exitCode: 1,
      });
    });
  });

  describe("with --hot", () => {
    function spawnHot(dir) {
      const proc = Bun.spawn({
        cmd: [bunExe(), "--hot", "--no-clear-screen", "--preload", "./first.js", "--preload", "./second.js", "main.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      // Resolves to all the text read so far once it includes `expected` or the stream ends.
      const collect = stream => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let text = "";
        return async expected => {
          while (!text.includes(expected)) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
          }
          return text;
        };
      };
      return { proc, stdout: collect(proc.stdout), stderr: collect(proc.stderr) };
    }

    test("waits for the preloads to finish when a reload arrives while they load", async () => {
      using dir = tempDir("preload-hot", {
        "first.js": `
          if (!globalThis.savedOnce) {
            globalThis.savedOnce = true;
            const fs = require("node:fs");
            fs.writeFileSync(__filename, fs.readFileSync(__filename));
          }
          console.log("first ran");
        `,
        "second.js": `console.log("second ran");`,
        "main.js": `console.log("main ran");`,
      });
      const { proc, stdout } = spawnHot(dir);
      await using _ = proc;
      expect(await stdout("main ran\nmain ran\n")).toStartWith("first ran\nsecond ran\nmain ran\nmain ran\n");
    });

    test("finds the preloads on a reload after one changed the working directory and threw", async () => {
      using dir = tempDir("preload-hot", {
        "elsewhere/keep.txt": "",
        // After a preload fails, every reload loads the preloads again.
        "first.js": `process.chdir("elsewhere");\nthrow new Error("from first.js");`,
        "second.js": `console.log("second ran");`,
        "main.js": `console.log("main ran");`,
      });
      const { proc, stdout, stderr } = spawnHot(dir);
      await using _ = proc;
      expect(await stderr("error: from first.js")).toContain("error: from first.js");
      // Written in place: on Windows a rename onto first.js fails with EPERM while the other process runs.
      // A reload can read first.js while it is empty, so wait for the run that prints all three lines.
      writeFileSync(join(String(dir), "first.js"), `console.log("first ran");`);
      writeFileSync(join(String(dir), "main.js"), `console.log("main ran");`);
      const reloaded = "first ran\nsecond ran\nmain ran\n";
      expect(await Promise.race([stdout(reloaded), stderr("preload not found")])).toContain(reloaded);
    });

    test("reports a preload that was deleted before a reload, and the next reload still runs", async () => {
      using dir = tempDir("preload-hot", {
        // After a preload fails, every reload loads the preloads again.
        "first.js": `throw new Error("from first.js");`,
        "second.js": `console.log("second ran");`,
        "main.js": `console.log("main ran");`,
      });
      const { proc, stdout, stderr } = spawnHot(dir);
      await using _ = proc;
      expect(await stderr("error: from first.js")).toContain("error: from first.js");
      rmSync(join(String(dir), "first.js"));
      writeFileSync(join(String(dir), "main.js"), `console.log("main ran");`);
      expect(await stderr('preload not found "./first.js"')).toContain('preload not found "./first.js"');
      writeFileSync(join(String(dir), "first.js.new"), `console.log("first ran");`);
      renameSync(join(String(dir), "first.js.new"), join(String(dir), "first.js"));
      writeFileSync(join(String(dir), "main.js"), `console.log("main ran");`);
      expect(await stdout("main ran\n")).toContain("first ran\nsecond ran\nmain ran\n");
    });
  });
});
