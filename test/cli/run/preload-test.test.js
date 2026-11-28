import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
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
  // #42469: AOT treats a literal ? in a decoded path as a query.
  test.todo("compiled modules retain encoded file URL identity", async () => {
    using dir = tempDir("compiled-file-url-identity", {
      "entry.ts": `
        import { pathToFileURL } from "node:url";
        const name: string = process.argv[2] ?? "literal?dir/dep.ts";
        const key = pathToFileURL(import.meta.dir + "/" + name).href;
        const first = require(key);
        const second = require(key.replace("%3F", "%3f"));
        const dataKey = pathToFileURL(import.meta.dir + "/literal?dir/data.json").href;
        const data = await import(dataKey, { with: { type: "json" } });
        console.log(first.value, first === second, data.default.value);
      `,
      "literal?dir/dep.ts": "export const value = 42;",
      "literal?dir/data.json": '{"value":42}',
    });
    const executable = join(String(dir), process.platform === "win32" ? "app.exe" : "app");
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "entry.ts",
        "literal?dir/dep.ts",
        "literal?dir/data.json",
        "--root",
        ".",
        "--outfile",
        executable,
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildOut, buildError, buildExit] = await Promise.all([
      build.stdout.text(),
      build.stderr.text(),
      build.exited,
    ]);
    expect({ buildOut: buildExit ? buildOut : "", buildError: buildExit ? buildError : "", buildExit }).toEqual({
      buildOut: "",
      buildError: "",
      buildExit: 0,
    });
    await using proc = Bun.spawn({ cmd: [executable], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "42 true 42\n", stderr: "", exitCode: 0 });
  });

  describe.each(["--import", "--preload", "-r"])("%s file URLs", flag => {
    test.concurrent.each(["plain", "with space"])("loads a preload from %s", async folder => {
      using dir = tempDir("preload-file-url", {
        [`${folder}/preload.mjs`]: `globalThis.preloaded = true;`,
        "main.mjs": `console.log(globalThis.preloaded);`,
      });
      const url = pathToFileURL(join(String(dir), folder, "preload.mjs"));
      await using proc = Bun.spawn({
        cmd: [bunExe(), flag, url.href, "main.mjs"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    });

    test.concurrent.each(["?generation=1", "#generation-1"])("keeps existing resolution of suffix %s", async suffix => {
      using dir = tempDir("preload-file-url-suffix", {
        "with space/preload.mjs": `throw new Error("preload must not run");`,
        "main.mjs": `console.log("main must not run");`,
      });
      const url = pathToFileURL(join(String(dir), "with space", "preload.mjs")).href + suffix;
      await using proc = Bun.spawn({
        cmd: [bunExe(), flag, url, "main.mjs"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "",
        stderr: `error: preload not found ${JSON.stringify(url)}\n`,
        exitCode: 1,
      });
    });

    test.concurrent("rejects an invalid file URL without resolving its fragment as a package import", async () => {
      using dir = tempDir("preload-invalid-file-url", {
        "package.json": JSON.stringify({ imports: { "#preload": "./wrong.mjs" } }),
        "wrong.mjs": `console.log("wrong preload");`,
        "main.mjs": `console.log("main must not run");`,
      });
      const url = "file://%zz#preload";
      await using proc = Bun.spawn({
        cmd: [bunExe(), flag, url, "main.mjs"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "",
        stderr: `error: preload not found ${JSON.stringify(url)}\n`,
        exitCode: 1,
      });
    });
  });

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
