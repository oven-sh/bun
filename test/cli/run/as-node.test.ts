import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe, fakeNodeRun, isLinux, isMacOS, isWindows, tempDir } from "../../harness";

describe("fake node cli", () => {
  test("the node cli actually works", () => {
    using temp = tempDir("fake-node", {
      "index.ts": "console.log(Bun.version)",
    });
    expect(fakeNodeRun(temp, join(temp, "index.ts")).stdout).toBe(Bun.version);
  });
  test("doesnt resolve bins", () => {
    using temp = tempDir("fake-node", {
      "vite.js": "console.log('pass')",
      "node_modules/.bin/vite": "#!/usr/bin/sh\necho fail && exit 1",
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("doesnt resolve scripts", () => {
    using temp = tempDir("fake-node", {
      "vite.js": "console.log('pass')",
      "package.json": '{"scripts":{"vite":"echo fail && exit 1"}}',
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("can run a script named run.js", () => {
    using temp = tempDir("fake-node", {
      "run.js": "console.log('pass')",
      "run/index.js": "console.log('fail')",
      "node_modules/run/index.js": "console.log('fail')",
    });
    expect(fakeNodeRun(temp, "run").stdout).toBe("pass");
  });
  // A Windows command line is too short for a path longer than the path buffer.
  test.skipIf(isWindows)("reports module not found for a relative script path longer than PATH_MAX", () => {
    const long = Array(21).fill(Buffer.alloc(200, "a").toString()).join("/") + ".js";
    using temp = tempDir("fake-node-long", {});
    const { exitCode, stdout, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "--bun", "node", long],
      cwd: String(temp),
      env: { ...bunEnv, NODE_ENV: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBe("");
    const path = join(String(temp), long);
    // On macOS the lookup fails in a syscall, so the error is ENAMETOOLONG.
    const expected = isMacOS
      ? `error: ENAMETOOLONG while resolving '${path}' from 'bun:main'`
      : `error: Module not found '${path}'`;
    expect(stderr.toString().split("\n")[0]).toBe(expected);
    expect(exitCode).toBe(1);
  });
  describe("entrypoint file extension picking", () => {
    // Bun supports JSX and TS, and node doesnt, so our behavior here differs a bit
    // Hopefully these priorization rules will not break any node apps.
    test("picks tsx over any other ext", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.jsx": "console.log('fail (build.jsx)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('fail (build.mts)')",
        "build.tsx": "console.log('pass')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks jsx over ts", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.jsx": "console.log('pass')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('fail (build.mts)')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks mts over ts", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('pass')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks ts over js/cjs/etc", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('pass')",
        "build.cts": "console.log('fail (build.cts)')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
  });

  test("node -e ", () => {
    using temp = tempDir("fake-node", {});
    expect(fakeNodeRun(temp, ["-e", "console.log('pass')"]).stdout).toBe("pass");
  });

  test("process args work", () => {
    using temp = tempDir("fake-node", {
      "index.js": "console.log(JSON.stringify(process.argv.slice(1)))",
    });
    expect(fakeNodeRun(temp, ["index", "a", "b", "c"]).stdout).toBe(
      // note: no extension here is INTENTIONAL
      JSON.stringify([join(temp, "index"), "a", "b", "c"]),
    );
  });

  // Bare `node` now matches Node.js: a TTY stdin enters the REPL, a
  // non-TTY stdin (pipe) prints "Missing script". fakeNodeRun's default
  // stdin is platform-dependent (Windows may inherit a console), so pin
  // a piped stdin here.
  test("no args with piped stdin errors with 'Missing script'", () => {
    using temp = tempDir("fake-node", {});
    const result = Bun.spawnSync([bunExe(), "--bun", "node"], {
      cwd: temp,
      env: { ...bunEnv, NODE_ENV: undefined },
      stdin: Buffer.alloc(0),
    });
    expect(result.stderr.toString()).toContain("Missing script");
    expect(result.success).toBe(false);
  });

  // These tests are not concurrent. In a debug build each `bun --bun` deletes and makes again the
  // directory of the `node` shim, so a concurrent one can fail with `Script not found "node"`.

  // `node ./pkg`, `node .`, `node ./entry` and `node ./bin/link` do not name the file that runs.
  describe("an entry point that does not name the file that runs", () => {
    const cjs = `console.log(JSON.stringify({
      argv1: process.argv[1],
      filename: __filename,
      requireMain: require.main === module,
      mainModule: process.mainModule === module,
      bunMain: Bun.main,
    }));`;
    const esm = `console.log(JSON.stringify({
      argv1: process.argv[1],
      filename: import.meta.filename,
      importMetaMain: import.meta.main,
      bunMain: Bun.main,
    }));`;
    const entryPoints = [
      { name: "a directory", pkg: {}, file: "pkg/index.js", cwd: ".", arg: "./pkg", argv1: "pkg" },
      {
        name: "`.` with a package.json main",
        pkg: { main: "./lib/entry.js" },
        file: "pkg/lib/entry.js",
        cwd: "pkg",
        arg: ".",
        argv1: "pkg",
      },
      {
        name: "a file without its extension",
        pkg: {},
        file: "pkg/entry.js",
        cwd: "pkg",
        arg: "./entry",
        argv1: "pkg/entry",
      },
    ];

    test.each(entryPoints)("CommonJS, $name", async ({ pkg, file, cwd, arg, argv1 }) => {
      using temp = tempDir("fake-node-main", { "pkg/package.json": JSON.stringify(pkg), [file]: cjs });
      const result = await runAsNode(join(temp, cwd), [arg]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual({
        stdout: {
          argv1: join(temp, argv1),
          filename: join(temp, file),
          requireMain: true,
          mainModule: true,
          bunMain: join(temp, file),
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test.each(entryPoints)("ESM, $name", async ({ pkg, file, cwd, arg, argv1 }) => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": JSON.stringify({ ...pkg, type: "module" }),
        [file]: esm,
      });
      const result = await runAsNode(join(temp, cwd), [arg]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual({
        stdout: {
          argv1: join(temp, argv1),
          filename: join(temp, file),
          importMetaMain: true,
          bunMain: join(temp, file),
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test("CommonJS, a symlink", async () => {
      using temp = tempDir("fake-node-main", { "pkg/package.json": "{}", "pkg/cli.js": cjs });
      mkdirSync(join(temp, "bin"));
      symlinkSync(join("..", "pkg", "cli.js"), join(temp, "bin", "link"));
      const result = await runAsNode(String(temp), ["./bin/link"]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual({
        stdout: {
          argv1: join(temp, "bin", "link"),
          filename: join(temp, "pkg", "cli.js"),
          requireMain: true,
          mainModule: true,
          bunMain: join(temp, "pkg", "cli.js"),
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // Node keeps a symlink in the path of the main module only with `--preserve-symlinks-main`.
    test("NODE_PRESERVE_SYMLINKS=1: the main module is the real path, and an import keeps the symlink", async () => {
      using temp = tempDir("fake-node-main", {
        "real/package.json": "{}",
        "real/entry.js": `console.log(JSON.stringify({
          filename: __filename,
          requireMain: require.main === module,
          imported: require(process.cwd() + "/import.js"),
        }));`,
        "real/dep.js": "module.exports = __filename;",
        "import.js": `module.exports = require("./link/dep.js");`,
      });
      symlinkSync(join(temp, "real"), join(temp, "link"), "dir");
      const result = await runAsNode(String(temp), ["./link/entry.js"], { NODE_PRESERVE_SYMLINKS: "1" });
      expect({ ...result, stdout: parse(result.stdout) }).toEqual({
        stdout: {
          filename: join(temp, "real", "entry.js"),
          requireMain: true,
          imported: join(temp, "link", "dep.js"),
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test("NODE_PRESERVE_SYMLINKS=1 and --preserve-symlinks-main: the main module keeps the path through the symlink", async () => {
      using temp = tempDir("fake-node-main", {
        "real/package.json": "{}",
        "real/entry.js": "console.log(__filename);",
      });
      symlinkSync(join(temp, "real"), join(temp, "link"), "dir");
      const args = ["--preserve-symlinks-main", "./link/entry.js"];
      const result = await runAsNode(String(temp), args, { NODE_PRESERVE_SYMLINKS: "1" });
      expect(result).toEqual({ stdout: join(temp, "link", "entry.js") + "\n", stderr: "", exitCode: 0 });
    });

    // The entry point imports a package from `node_modules` above it, which needs the parents of each new directory.
    test.each([
      { name: "the index file of the directory", pkg: {}, arg: "./pkg", file: "pkg/index.js" },
      {
        name: "the package.json main in new directories",
        pkg: { main: "./dist/esm/main.js" },
        arg: "./pkg",
        file: "pkg/dist/esm/main.js",
      },
      { name: "a file in new directories", pkg: {}, arg: "./out/esm/main.js", file: "out/esm/main.js" },
    ])("a preload can create the entry point: $name", async ({ pkg, arg, file }) => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": JSON.stringify(pkg),
        "node_modules/dep/index.js": "module.exports = 'entry ran';",
        "pre.js": `
          const { mkdirSync, writeFileSync } = require("fs");
          const { dirname, join } = require("path");
          const file = join(__dirname, ${JSON.stringify(file)});
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, "console.log(require('dep'));");
        `,
      });
      const result = await runAsNode(String(temp), ["-r", "./pre.js", arg]);
      expect(result).toEqual({ stdout: "entry ran\n", stderr: "", exitCode: 0 });
    });

    test.each([
      { name: "a trailing separator", arg: (_: string) => "./missing/" },
      { name: "a doubled separator", arg: (temp: string) => temp + "//missing" },
    ])("an entry point that does not exist, with $name, fails as before", async ({ arg }) => {
      using temp = tempDir("fake-node-main", {});
      const { stdout, stderr, exitCode } = await runAsNode(String(temp), [arg(String(temp))]);
      expect({ stdout, error: stderr.split("\n")[0].slice(0, 24), exitCode }).toEqual({
        stdout: "",
        error: "error: Module not found ",
        exitCode: 1,
      });
    });

    test("a main field that is longer than a path is not found", async () => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": JSON.stringify({ main: "./" + Buffer.alloc(8192, "a").toString() + ".js" }),
      });
      const { stdout, stderr, exitCode } = await runAsNode(String(temp), ["./pkg"]);
      expect({ stdout, error: stderr.split("\n")[0].slice(0, 24), exitCode }).toEqual({
        stdout: "",
        error: "error: Module not found ",
        exitCode: 1,
      });
    });

    test("a package.json that does not parse adds no output", async () => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": "{",
        "pkg/index.js": "console.log(require.main === module);",
      });
      expect(await runAsNode(String(temp), ["./pkg"])).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    });

    test("cron execution mode still calls scheduled()", async () => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": JSON.stringify({ type: "module" }),
        "pkg/index.js": "export default { scheduled(controller) { console.log(controller.cron); } };",
      });
      const result = await runAsNode(String(temp), ["--cron-title=job", "--cron-period=* * * * *", "./pkg"]);
      expect(result).toEqual({ stdout: "* * * * *\n", stderr: "", exitCode: 0 });
    });

    test("the Bun shell `$1` is process.argv[1]", async () => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": JSON.stringify({ type: "module" }),
        "pkg/index.js": "console.log(JSON.stringify([process.argv[1], (await Bun.$`echo $1`.text()).trim()]));",
      });
      const result = await runAsNode(String(temp), ["./pkg"]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual({
        stdout: [join(temp, "pkg"), join(temp, "pkg")],
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // Until the main module loads, Bun parses an import with an unknown extension as code.
  describe("an import with an unknown extension is an asset", () => {
    const files = {
      "pkg/package.json": JSON.stringify({ type: "module" }),
      "pkg/index.js": `
        import asset from "./asset.bin";
        import { basename } from "node:path";
        console.log(JSON.stringify({ filename: import.meta.filename, asset: basename(asset) }));`,
      "pkg/asset.bin": "this is not javascript {",
    };
    const loaded = (temp: string) => ({
      stdout: { filename: join(temp, "pkg", "index.js"), asset: "asset.bin" },
      stderr: "",
      exitCode: 0,
    });

    test("when the entry point is a directory", async () => {
      using temp = tempDir("fake-node-asset", files);
      const result = await runAsNode(String(temp), ["./pkg"]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual(loaded(temp));
    });

    // On Windows the module loader names the entry point with `\`.
    test("when the entry point is an absolute path with `/`", async () => {
      using temp = tempDir("fake-node-asset", files);
      const result = await runAsNode(String(temp), [join(temp, "pkg", "index.js").replaceAll("\\", "/")]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual(loaded(temp));
    });

    test("when the entry point is a symlink", async () => {
      using temp = tempDir("fake-node-asset", files);
      mkdirSync(join(temp, "bin"));
      symlinkSync(join("..", "pkg", "index.js"), join(temp, "bin", "link"));
      const result = await runAsNode(String(temp), ["./bin/link"]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual(loaded(temp));
    });
  });

  // The watcher finds a replaced entry point again by the path of the file that runs (`MainFile` in hot_reloader.rs).
  // Not for Windows: its watcher does not read `MainFile`, and a rename over a file that is open can fail there.
  describe.concurrent.skipIf(isWindows)("a watcher reloads an entry point that is replaced", () => {
    const source = (n: number) => `console.log("ready ${n}"); globalThis.timer ??= setInterval(() => {}, 1000);`;
    const inProject = [
      { name: "a directory", cwd: ".", arg: "./pkg", file: "pkg/index.js" },
      { name: "`.`", cwd: "pkg", arg: ".", file: "pkg/index.js" },
      { name: "a file without its extension", cwd: ".", arg: "./pkg/entry", file: "pkg/entry.js" },
      { name: "a symlink", cwd: ".", arg: "./bin/link", file: "pkg/cli.js" },
    ];
    // The watcher does not watch a directory outside the working directory for the files in it.
    const outside = [
      { name: "a directory", cwd: "work", arg: "../pkg", file: "pkg/index.js" },
      { name: "a file without its extension", cwd: "work", arg: "../pkg/entry", file: "pkg/entry.js" },
      { name: "a file", cwd: "work", arg: "../pkg/index.js", file: "pkg/index.js" },
    ];
    type EntryPoint = { cwd: string; arg: string; file: string };

    function project({ file }: EntryPoint, files: Record<string, string> = {}) {
      const temp = tempDir("fake-node-hot", {
        "pkg/package.json": "{}",
        "work/package.json": "{}",
        "stage/trace.log": "",
        [file]: source(1),
        ...files,
      });
      mkdirSync(join(temp, "bin"));
      symlinkSync(join("..", "pkg", "cli.js"), join(temp, "bin", "link"));
      return temp;
    }

    function run(temp: string, args: string[], { cwd }: EntryPoint, argv0 = "node") {
      return Bun.spawn({
        cmd: [bunExe(), ...args],
        argv0,
        cwd: join(temp, cwd),
        env: { ...bunEnv, NODE_ENV: undefined, BUN_WATCHER_TRACE: join(temp, "stage", "trace.log") },
        stdout: "pipe",
        stderr: "pipe",
      });
    }

    // The new file is written in another directory, so the rename is the only event in the directory of the entry point.
    function replaceByRename(temp: string, { file }: EntryPoint, n: number) {
      writeFileSync(join(temp, "stage", "new.js"), source(n));
      renameSync(join(temp, "stage", "new.js"), join(temp, file));
    }

    // The events of each batch, by watched path. The watcher writes a batch before it handles it.
    function batches(temp: string): Record<string, { events: string[] }>[] {
      const lines = readFileSync(join(temp, "stage", "trace.log"), "utf8").split("\n");
      return lines.slice(0, -1).map(line => JSON.parse(line).files);
    }

    const batchesOf = (temp: string, path: string) => batches(temp).filter(files => join(temp, path) in files);

    async function batchWith(temp: string, path: string, event: string) {
      while (!batchesOf(temp, path).some(files => files[join(temp, path)].events.includes(event))) await Bun.sleep(1);
    }

    // Only inotify finds a file again that is deleted first.
    test.skipIf(!isLinux).each(inProject)("--hot, $name, deleted and then created", async entryPoint => {
      using temp = project(entryPoint);
      await using proc = run(temp, ["--hot", entryPoint.arg], entryPoint);
      const stdout = proc.stdout.getReader();
      await until(stdout, "ready 1");
      rmSync(join(temp, entryPoint.file));
      // The delete starts a reload, which fails. Without this wait that reload can find the new file.
      await until(proc.stderr.getReader(), "Module not found");
      writeFileSync(join(temp, entryPoint.file), source(2));
      await until(stdout, "ready 2");
    });

    describe.each(["--hot", "--watch"])("%s", flag => {
      test.each(inProject)("$name, replaced by a rename", async entryPoint => {
        using temp = project(entryPoint);
        await using proc = run(temp, [flag, entryPoint.arg], entryPoint);
        const stdout = proc.stdout.getReader();
        await until(stdout, "ready 1");
        replaceByRename(temp, entryPoint, 2);
        await until(stdout, "ready 2");
      });

      // The second rename shows that the watch is on the file that has the path now.
      test.each(outside)("$name outside the working directory, replaced by a rename two times", async entryPoint => {
        using temp = project(entryPoint);
        await using proc = run(temp, [flag, entryPoint.arg], entryPoint);
        const stdout = proc.stdout.getReader();
        await until(stdout, "ready 1");
        replaceByRename(temp, entryPoint, 2);
        await until(stdout, "ready 2");
        replaceByRename(temp, entryPoint, 3);
        await until(stdout, "ready 3");
      });

      // While the path has no file, nothing reloads. The watcher then finds the new file through the directory.
      test.each(outside)("$name outside the working directory, deleted and then created", async entryPoint => {
        using temp = project(entryPoint);
        await using proc = run(temp, [flag, entryPoint.arg], entryPoint);
        const stdout = proc.stdout.getReader();
        await until(stdout, "ready 1");
        rmSync(join(temp, entryPoint.file));
        await batchWith(temp, entryPoint.file, "delete");
        writeFileSync(join(temp, entryPoint.file), source(2));
        await until(stdout, "ready 2");
      });

      test.each(outside)("$name outside the working directory, renamed away and then created", async entryPoint => {
        using temp = project(entryPoint);
        await using proc = run(temp, [flag, entryPoint.arg], entryPoint);
        const stdout = proc.stdout.getReader();
        await until(stdout, "ready 1");
        renameSync(join(temp, entryPoint.file), join(temp, entryPoint.file + "~"));
        await batchWith(temp, entryPoint.file, "rename");
        writeFileSync(join(temp, entryPoint.file), source(2));
        await until(stdout, "ready 2");
      });
    });

    // The files beside an entry point outside the working directory keep only their own watches.
    test.each([
      { name: "the node shim, a directory", argv0: "node", arg: "../pkg" },
      { name: "bun, a file", argv0: "bun", arg: "../pkg/index.js" },
    ])("--hot, $name outside the working directory: a write to another file there starts no reload", async row => {
      const entryPoint = { cwd: "work", arg: row.arg, file: "pkg/index.js" };
      using temp = project(entryPoint);
      await using proc = run(temp, ["--hot", row.arg], entryPoint, row.argv0);
      const stdout = proc.stdout.getReader();
      let seen = await until(stdout, "ready 1");
      for (let i = 0; i < 20; i++) appendFileSync(join(temp, "pkg", "app.log"), "line\n");
      writeFileSync(join(temp, entryPoint.file), source(2));
      seen += await until(stdout, "ready 2");
      expect({
        before: seen.slice(0, seen.indexOf("ready 2")),
        watched: [...new Set(batches(temp).flatMap(files => Object.keys(files)))],
      }).toEqual({ before: "ready 1\n", watched: [join(temp, entryPoint.file)] });
    });

    test("--hot, a directory outside the working directory: while the entry file is missing, a new file beside it starts no reload", async () => {
      const entryPoint = outside[0];
      using temp = project(entryPoint);
      await using proc = run(temp, ["--hot", entryPoint.arg], entryPoint);
      const stdout = proc.stdout.getReader();
      let seen = await until(stdout, "ready 1");
      rmSync(join(temp, entryPoint.file));
      await batchWith(temp, entryPoint.file, "delete");
      // The watch of the directory starts when the watcher handles the batch of the delete.
      for (let i = 0; batchesOf(temp, "pkg/").length === 0; i++) {
        writeFileSync(join(temp, "pkg", `other-${i}.js`), "");
        await Bun.sleep(1);
      }
      writeFileSync(join(temp, entryPoint.file), source(2));
      seen += await until(stdout, "ready 2");
      proc.kill();
      // A debug build prints a line for each reload. A reload while the file is missing prints an error.
      const stderr = (await proc.stderr.text()).replaceAll("DEBUG: Reloading...\n", "");
      expect({ before: seen.slice(0, seen.indexOf("ready 2")), stderr }).toEqual({ before: "ready 1\n", stderr: "" });
    });

    test("--hot, a directory outside the working directory: the watch of the directory ends when the entry file is back", async () => {
      const entryPoint = outside[0];
      using temp = project(entryPoint);
      await using proc = run(temp, ["--hot", entryPoint.arg], entryPoint);
      const stdout = proc.stdout.getReader();
      await until(stdout, "ready 1");
      rmSync(join(temp, entryPoint.file));
      await batchWith(temp, entryPoint.file, "delete");
      writeFileSync(join(temp, entryPoint.file), source(2));
      await until(stdout, "ready 2");
      // The watcher drops the watch of the directory at its next event. The batch of the write after it is handled later.
      writeFileSync(join(temp, "pkg", "other-0.js"), "");
      writeFileSync(join(temp, entryPoint.file), source(3));
      await until(stdout, "ready 3");
      const ofDirectory = batchesOf(temp, "pkg/").length;
      for (let i = 1; i <= 5; i++) writeFileSync(join(temp, "pkg", `other-${i}.js`), "");
      writeFileSync(join(temp, entryPoint.file), source(4));
      await until(stdout, "ready 4");
      expect(batchesOf(temp, "pkg/").length).toBe(ofDirectory);
    });

    // The watcher has no watch in the directory of the entry point before the entry point loads.
    test("--watch, a directory outside the working directory: a preload that writes the entry file starts the program one time", async () => {
      const entryPoint = outside[0];
      using temp = project(entryPoint, {
        "work/preload.js": `
          const { appendFileSync, writeFileSync } = require("fs");
          appendFileSync(__dirname + "/starts", "start\\n");
          writeFileSync(__dirname + "/../pkg/index.js", ${JSON.stringify(source(1))});
        `,
      });
      await using proc = run(temp, ["--watch", "-r", "./preload.js", entryPoint.arg], entryPoint);
      await until(proc.stdout.getReader(), "ready 1");
      expect(readFileSync(join(temp, "work", "starts"), "utf8")).toBe("start\n");
    });
  });
});

// Reads until `text` arrives, and returns what it read. It throws when the stream ends first, so a child that exits fails the test.
async function until(reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> }, text: string) {
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes(text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the stream ended before ${JSON.stringify(text)}, after ${JSON.stringify(seen)}`);
    seen += decoder.decode(value, { stream: true });
  }
  return seen;
}

async function runAsNode(cwd: string, args: string[], env?: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--bun", "node", ...args],
    cwd,
    env: { ...bunEnv, NODE_ENV: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A child that fails prints no JSON. Keep what it printed for the failure message.
function parse(stdout: string) {
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}
