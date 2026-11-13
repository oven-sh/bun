import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

describe.concurrent("Module.runMain of a script that fails", () => {
  // Each script, and the line that reports it on stderr.
  const failing = {
    "throws.cjs": [`throw new Error("from throws.cjs");`, "error: from throws.cjs"],
    "throws.mjs": [`throw new Error("from throws.mjs");`, "error: from throws.mjs"],
    "rejects.mjs": [`await Promise.reject(new Error("from rejects.mjs"));`, "error: from rejects.mjs"],
    "syntax.cjs": [`const x = ;`, "error: Unexpected ;"],
    "imports-missing.mjs": [`import "./missing.mjs";`, "error: Cannot find module './missing.mjs'"],
    "requires-missing.cjs": [`require("./missing.cjs");`, "error: Cannot find module './missing.cjs'"],
  };
  const scripts = {
    ...Object.fromEntries(Object.entries(failing).map(([name, [source]]) => [name, source])),
    "prints.cjs": `console.log("script");`,
    "prints.mjs": `console.log("script");`,
    "waits.mjs": `await 0; console.log("script");`,
    // A script that stays in its top-level await: inAwait() tells that it is there, open() lets it fail.
    "gated.mjs": `inAwait(); await gate; throw new Error("from gated.mjs");`,
  };
  const gate = `
    const inAwait = new Promise(resolve => (globalThis.inAwait = resolve));
    globalThis.gate = new Promise(resolve => (globalThis.open = resolve));
  `;
  const listeners = `
    process.on("uncaughtException", (error, origin) => console.log(origin + ": " + error.message));
    process.on("unhandledRejection", error => console.log("unhandledRejection listener: " + error.message));
    process.on("exit", code => console.log("exit " + code));
  `;

  // `stderr` is every line of it that is not the code frame, the stack or the version line of a report.
  async function runIn(cwd, ...args) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const said = stderr
      .split("\n")
      .filter(line => line && !/^\s*(\d+ \| |\^$|at )|^Bun v/.test(line))
      .map(line => line.replace(/ from '.*'$/, ""));
    return { stdout, stderr: said, exitCode };
  }
  // Runs bun in a directory that has the scripts and `files`.
  async function run(files, ...args) {
    using dir = tempDir("module-run-main", { ...scripts, ...files });
    return await runIn(String(dir), ...args);
  }

  test.each(Object.entries(failing))("%s is reported, and the exit code is 1", async (script, [, error]) => {
    const main = `require("node:module").runMain("./${script}");`;
    expect(await run({ "main.cjs": main }, "main.cjs")).toEqual({ stdout: "", stderr: [error], exitCode: 1 });
  });

  const override = body => `
    const Module = require("node:module");
    const runMain = Module.runMain;
    Module.runMain = ${body};
  `;
  // An import() that catches the failure of the script started it, and the script is in its top-level await.
  const joins = `
    import Module from "node:module";
    ${gate}
    import("./gated.mjs").catch(error => console.log("caught: " + error.message));
    await inAwait;
    Module.runMain("./gated.mjs");
    open();
  `;
  test.each([
    [
      "an ES module",
      { "main.mjs": `import Module from "node:module"; Module.runMain("./throws.cjs");` },
      ["main.mjs"],
      { stdout: "", stderr: ["error: from throws.cjs"], exitCode: 1 },
    ],
    [
      "a callback",
      { "main.cjs": `setImmediate(() => require("node:module").runMain("./throws.mjs"));` },
      ["main.cjs"],
      { stdout: "", stderr: ["error: from throws.mjs"], exitCode: 1 },
    ],
    [
      "process.nextTick, with the process state that Corepack sets",
      {
        "main.cjs": `
          const script = require("node:path").resolve("throws.cjs");
          process.argv = [process.execPath, script];
          process.execArgv = [];
          process.mainModule = undefined;
          process.nextTick(require("node:module").runMain, script);
        `,
      },
      ["main.cjs"],
      { stdout: "", stderr: ["error: from throws.cjs"], exitCode: 1 },
    ],
    [
      "a call with the arguments that istanbul passes",
      { "main.cjs": `require("node:module").runMain(require("node:path").resolve("throws.cjs"), null, true);` },
      ["main.cjs"],
      { stdout: "", stderr: ["error: from throws.cjs"], exitCode: 1 },
    ],
    [
      "--eval",
      {},
      ["--eval", `require("node:module").runMain("./rejects.mjs");`],
      { stdout: "", stderr: ["error: from rejects.mjs"], exitCode: 1 },
    ],
    [
      "a preload",
      { "preload.cjs": `require("node:module").runMain("./rejects.mjs");`, "main.cjs": `console.log("main ran");` },
      ["--require", "./preload.cjs", "main.cjs"],
      { stdout: "main ran\n", stderr: ["error: from rejects.mjs"], exitCode: 1 },
    ],
    [
      "a preload's Module.runMain, after it started the main file",
      {
        "preload.cjs": override(`main => { runMain(main); runMain("./throws.mjs"); }`),
        "main.cjs": `console.log("main ran");`,
      },
      ["--require", "./preload.cjs", "main.cjs"],
      { stdout: "main ran\n", stderr: ["error: from throws.mjs"], exitCode: 1 },
    ],
    [
      "a preload's Module.runMain, after an await",
      {
        "preload.cjs": override(`async main => { await 0; runMain(main); }`),
        "main.cjs": `throw new Error("from main.cjs");`,
      },
      ["--require", "./preload.cjs", "main.cjs"],
      { stdout: "", stderr: ["error: from main.cjs"], exitCode: 1 },
    ],
    [
      "a preload's Module.runMain, for a main file that an earlier preload started and that still waits",
      {
        "first.cjs": `${gate} require("node:module").runMain(process.argv[1]);`,
        "second.cjs": override(`() => { runMain(process.argv[1]); open(); }`),
        "main.mjs": `await gate; throw new Error("from main.mjs");`,
      },
      ["--require", "./first.cjs", "--require", "./second.cjs", "main.mjs"],
      { stdout: "", stderr: ["error: from main.mjs"], exitCode: 1 },
    ],
    [
      "a preload that sets a Module.runMain that starts nothing, and starts the main file itself",
      {
        "preload.cjs": override(`() => {}`) + `runMain(process.argv[1]);`,
        "main.cjs": `throw new Error("from main.cjs");`,
      },
      ["--require", "./preload.cjs", "main.cjs"],
      { stdout: "", stderr: ["error: from main.cjs"], exitCode: 1 },
    ],
    [
      "a plugin's onLoad for the main file, inside a preload's Module.runMain",
      {
        "preload.cjs":
          override(`() => runMain(process.argv[1])`) +
          `Bun.plugin({
            setup(build) {
              build.onLoad({ filter: /main\\.cjs$/ }, () => {
                runMain("./throws.mjs");
                return { contents: 'console.log("main ran");', loader: "js" };
              });
            },
          });`,
        "main.cjs": ``,
      },
      ["--preload", "./preload.cjs", "main.cjs"],
      { stdout: "main ran\n", stderr: ["error: from throws.mjs"], exitCode: 1 },
    ],
    [
      "a Worker",
      {
        "main.mjs": `
          const worker = new Worker(new URL("./worker.cjs", import.meta.url));
          worker.addEventListener("error", event => console.log("error event: " + /^error: .*$/m.exec(event.message)));
          worker.addEventListener("close", event => console.log("close event: " + event.code));
        `,
        "worker.cjs": `require("node:module").runMain("./throws.mjs");`,
      },
      ["main.mjs"],
      { stdout: "error event: error: from throws.mjs\nclose event: 1\n", stderr: [], exitCode: 0 },
    ],
    [
      "the code of a Bun.ModuleGraph, whose onError takes it",
      {
        "main.mjs": `
          const graph = new Bun.ModuleGraph({ onError: (error, kind) => console.log(kind + ": " + error.message) });
          await graph.import(import.meta.dir + "/in-graph.cjs");
        `,
        "in-graph.cjs": `require("node:module").runMain("./throws.mjs");`,
      },
      ["main.mjs"],
      { stdout: "unhandledRejection: from throws.mjs\n", stderr: [], exitCode: 0 },
    ],
    [
      "a module that imports the script as text",
      {
        "main.mjs": `
          import Module from "node:module";
          import text from "./throws.mjs" with { type: "text" };
          console.log(text);
          Module.runMain("./throws.mjs");
        `,
      },
      ["main.mjs"],
      { stdout: `throw new Error("from throws.mjs");\n`, stderr: ["error: from throws.mjs"], exitCode: 1 },
    ],
    [
      "a module that caught the failure of an import before the script in the same graph",
      {
        "main.mjs": `
          import Module from "node:module";
          await import("./graph.mjs").catch(error => console.log("caught: " + error.message));
          Module.runMain("./throws.mjs");
        `,
        "graph.mjs": `import "./first.mjs"; import "./throws.mjs";`,
        "first.mjs": `throw new Error("from first.mjs");`,
      },
      ["main.mjs"],
      { stdout: "caught: from first.mjs\n", stderr: ["error: from throws.mjs"], exitCode: 1 },
    ],
    [
      "a module that caught a graph that has the script and an import that is not found",
      {
        "main.mjs": `
          import Module from "node:module";
          await import("./graph.mjs").catch(() => console.log("caught"));
          Module.runMain("./throws.mjs");
        `,
        "graph.mjs": `import "./throws.mjs"; import "./missing.mjs";`,
      },
      ["main.mjs"],
      { stdout: "caught\n", stderr: ["error: from throws.mjs"], exitCode: 1 },
    ],
    [
      "a module that caught an import of the script, while the script is in its top-level await",
      { "main.mjs": joins },
      ["main.mjs"],
      { stdout: "caught: from gated.mjs\n", stderr: ["error: from gated.mjs"], exitCode: 1 },
    ],
    [
      "a module whose require() of the script threw, because the script has a top-level await",
      {
        "main.cjs": `
          ${gate}
          try {
            require("./gated.mjs");
          } catch {
            console.log("require threw");
          }
          require("node:module").runMain("./gated.mjs");
          open();
        `,
      },
      ["main.cjs"],
      { stdout: "require threw\n", stderr: ["error: from gated.mjs"], exitCode: 1 },
    ],
  ])("called from %s", async (_, files, args, expected) => {
    expect(await run(files, ...args)).toEqual(expected);
  });

  test.each([
    ["none", "main.cjs", { stdout: "", stderr: ["error: from rejects.mjs"], exitCode: 1 }],
    ["warn", "main.cjs", { stdout: "", stderr: ["error: from rejects.mjs"], exitCode: 1 }],
    ["none", "joins.mjs", { stdout: "caught: from gated.mjs\n", stderr: ["error: from gated.mjs"], exitCode: 1 }],
    ["warn", "joins.mjs", { stdout: "caught: from gated.mjs\n", stderr: ["error: from gated.mjs"], exitCode: 1 }],
  ])("with --unhandled-rejections=%s, %s", async (mode, main, expected) => {
    const files = { "main.cjs": `require("node:module").runMain("./rejects.mjs");`, "joins.mjs": joins };
    expect(await run(files, `--unhandled-rejections=${mode}`, main)).toEqual(expected);
  });

  test("is an uncaught exception with the origin unhandledRejection", async () => {
    const main = `${listeners} require("node:module").runMain("./rejects.mjs");`;
    expect(await run({ "main.cjs": main }, "main.cjs")).toEqual({
      stdout: "unhandledRejection: from rejects.mjs\nexit 0\n",
      stderr: [],
      exitCode: 0,
    });
  });

  test("is not for a listener for unhandled rejections", async () => {
    const main = `
      process.on("unhandledRejection", error => console.log("unhandledRejection listener: " + error.message));
      process.on("exit", code => console.log("exit " + code));
      require("node:module").runMain("./rejects.mjs");
    `;
    expect(await run({ "main.cjs": main }, "main.cjs")).toEqual({
      stdout: "exit 1\n",
      stderr: ["error: from rejects.mjs"],
      exitCode: 1,
    });
  });

  const caller = script => `
    console.log("before");
    try {
      require("node:module").runMain("./${script}");
    } catch {
      console.log("caught");
    }
    console.log("after");
  `;
  test.each([
    ["runs after the call returns", "waits.mjs", { stdout: "before\nafter\nscript\n", stderr: [], exitCode: 0 }],
    [
      "is not caught by the caller when it fails",
      "rejects.mjs",
      { stdout: "before\nafter\n", stderr: ["error: from rejects.mjs"], exitCode: 1 },
    ],
  ])("a script with a top-level await %s", async (_, script, expected) => {
    expect(await run({ "main.cjs": caller(script) }, "main.cjs")).toEqual(expected);
  });

  // Node 26.12 runs a script that has no top-level await inside the call. Bun starts it after the call returns.
  test.failing.each([
    ["prints.cjs", { stdout: "before\nscript\nafter\n", stderr: [], exitCode: 0 }],
    ["prints.mjs", { stdout: "before\nscript\nafter\n", stderr: [], exitCode: 0 }],
    ["throws.cjs", { stdout: "before\ncaught\nafter\n", stderr: [], exitCode: 0 }],
    ["throws.mjs", { stdout: "before\ncaught\nafter\n", stderr: [], exitCode: 0 }],
  ])("like Node, %s runs inside the call", async (script, expected) => {
    expect(await run({ "main.cjs": caller(script) }, "main.cjs")).toEqual(expected);
  });

  // In Bun the origin is unhandledRejection, because the script fails after the call returned.
  test.failing.each(["throws.cjs", "throws.mjs"])("like Node, %s has the origin uncaughtException", async script => {
    const main = `${listeners} require("node:module").runMain("./${script}");`;
    expect(await run({ "main.cjs": main }, "main.cjs")).toEqual({
      stdout: `uncaughtException: from ${script}\nexit 0\n`,
      stderr: [],
      exitCode: 0,
    });
  });

  test("a second call for a script that failed reports it again", async () => {
    const main = `
      const Module = require("node:module");
      let calls = 0;
      process.on("uncaughtException", (error, origin) => {
        console.log(origin + ": " + error.message);
        if (++calls === 1) Module.runMain("./rejects.mjs");
      });
      process.on("unhandledRejection", error => console.log("unhandledRejection listener: " + error.message));
      Module.runMain("./rejects.mjs");
    `;
    expect(await run({ "main.cjs": main }, "main.cjs")).toEqual({
      stdout: "unhandledRejection: from rejects.mjs\nunhandledRejection: from rejects.mjs\n",
      stderr: [],
      exitCode: 0,
    });
  });

  test("a second call for a script that is in its top-level await reports it too", async () => {
    const main = `
      const Module = require("node:module");
      process.on("uncaughtException", (error, origin) => console.log(origin + ": " + error.message));
      ${gate}
      Module.runMain("./gated.mjs");
      inAwait.then(() => {
        Module.runMain("./gated.mjs");
        open();
      });
    `;
    expect(await run({ "main.cjs": main }, "main.cjs")).toEqual({
      stdout: "unhandledRejection: from gated.mjs\nunhandledRejection: from gated.mjs\n",
      stderr: [],
      exitCode: 0,
    });
  });

  // The entry point reports its own module: a call for that module adds no second report.
  const preloadFor = key => `
    process.on("uncaughtException", error => console.log("uncaughtException: " + error.message));
    require("node:module").runMain(${key});
  `;
  const preloaded = key => ({
    "preload.cjs": preloadFor(key),
    "main.cjs": `console.log("main ran"); throw new Error("from main");`,
  });
  test.each([
    [
      "a CommonJS entry point that calls it for itself",
      { "main.cjs": `${listeners} require("node:module").runMain(__filename); throw new Error("from main");` },
      ["main.cjs"],
      "uncaughtException: from main\nexit 0\n",
    ],
    [
      "an ES module entry point that calls it for itself",
      {
        "main.mjs": `
          import Module from "node:module";
          ${listeners}
          Module.runMain(import.meta.filename);
          await 0;
          throw new Error("from main");
        `,
      },
      ["main.mjs"],
      "unhandledRejection: from main\nexit 0\n",
    ],
    [
      "a preload that calls it for the entry point",
      preloaded(`process.argv[1]`),
      ["--require", "./preload.cjs", "main.cjs"],
      "main ran\nuncaughtException: from main\n",
    ],
    [
      'a preload that calls it for "bun:main"',
      preloaded(`"bun:main"`),
      ["--require", "./preload.cjs", "main.cjs"],
      "main ran\nuncaughtException: from main\n",
    ],
    [
      "a preload that calls it for an entry point that node got without its extension",
      preloaded(`process.argv[1]`),
      ["--bun", "node", "--require", "./preload.cjs", "./main"],
      "main ran\nuncaughtException: from main\n",
    ],
  ])("%s is run and reported once", async (_, files, args, stdout) => {
    expect(await run(files, ...args)).toEqual({ stdout, stderr: [], exitCode: 0 });
  });

  test("a preload that calls it for an entry point that node got as a symlink is run and reported once", async () => {
    using dir = tempDir("module-run-main-symlink", preloaded(`process.argv[1]`));
    fs.symlinkSync("main.cjs", path.join(String(dir), "link.cjs"), "file");
    expect(await runIn(String(dir), "--bun", "node", "--require", "./preload.cjs", "./link.cjs")).toEqual({
      stdout: "main ran\nuncaughtException: from main\n",
      stderr: [],
      exitCode: 0,
    });
  });

  const startsThenReplaces = `
    const Module = require("node:module");
    Module.runMain(process.argv[1]);
    Module.runMain = () => {};
  `;
  test("a preload that calls it for the entry point, and then sets a Module.runMain, runs the entry point", async () => {
    const files = { "preload.cjs": startsThenReplaces, "main.cjs": `console.log("main ran");` };
    expect(await run(files, "--require", "./preload.cjs", "main.cjs")).toEqual({
      stdout: "main ran\n",
      stderr: [],
      exitCode: 0,
    });
  });

  // Bun reports nothing: the preload started the entry point, and after that preload Bun does not load it again.
  test.failing.each([
    [
      "then sets a Module.runMain that starts nothing",
      { "preload.cjs": startsThenReplaces, "main.cjs": `throw new Error("from main");` },
      "main.cjs",
      { stdout: "", stderr: ["error: from main"], exitCode: 1 },
    ],
    [
      "then sets a Module.runMain that starts nothing, for an ES module",
      { "preload.cjs": startsThenReplaces, "main.mjs": `await 0; throw new Error("from main");` },
      "main.mjs",
      { stdout: "", stderr: ["error: from main"], exitCode: 1 },
    ],
    [
      "then throws",
      {
        "preload.cjs": `${preloadFor(`process.argv[1]`)} throw new Error("from preload");`,
        "main.mjs": `await 0; throw new Error("from main");`,
      },
      "main.mjs",
      { stdout: "uncaughtException: from preload\nuncaughtException: from main\n", stderr: [], exitCode: 0 },
    ],
  ])(
    "like Node, an entry point is reported when a preload calls it for the entry point and %s",
    async (_, files, main, expected) => {
      expect(await run(files, "--require", "./preload.cjs", main)).toEqual(expected);
    },
  );

  // Bun prints the failure twice: the first report does not end the process before the second reporter runs.
  test.failing.each([
    [
      "a preload's Module.runMain calls the original twice for the entry point",
      {
        "preload.cjs": override(`main => { runMain(main); runMain(main); }`),
        "main.cjs": `throw new Error("from main");`,
      },
      ["--require", "./preload.cjs", "main.cjs"],
    ],
    [
      "a module calls it for a later import of the graph that is running",
      {
        "main.mjs": `import "./first.mjs"; import "./second.mjs";`,
        "first.mjs": `import Module from "node:module"; Module.runMain(import.meta.dir + "/second.mjs");`,
        "second.mjs": `throw new Error("from main");`,
      },
      ["main.mjs"],
    ],
  ])("like Node, the failure is printed once when %s", async (_, files, args) => {
    expect(await run(files, ...args)).toEqual({ stdout: "", stderr: ["error: from main"], exitCode: 1 });
  });

  test("in a test file, it fails the test that waits for the script", async () => {
    const files = {
      "script.mjs": `reached(); await Promise.reject(new Error("from script.mjs"));`,
      "wrapper.test.js": `
        import { test } from "bun:test";
        import Module from "node:module";
        test("starts a script", async () => {
          const reached = new Promise(resolve => (globalThis.reached = resolve));
          Module.runMain("./script.mjs");
          await reached;
          // The report comes before the immediate, so the test is still running.
          await new Promise(resolve => setImmediate(resolve));
        });
      `,
    };
    const { stderr, exitCode } = await run(files, "test", "./wrapper.test.js");
    expect({
      said: stderr.filter(line => /^(error: |\(fail\)|\(pass\))/.test(line)).map(line => line.replace(/ \[.*\]$/, "")),
      exitCode,
    }).toEqual({ said: ["error: from script.mjs", "(fail) starts a script"], exitCode: 1 });
  });

  test.each(["--hot", "--watch", "--watch --unhandled-rejections=none"])(
    "with %s, every reload reports it and the process keeps running",
    async flags => {
      // "done" comes after the report of its run, if there is a report.
      const version = n => `
        console.error("run ${n}");
        setImmediate(() => console.error("done ${n}"));
        throw new Error("failure ${n}");
      `;
      using dir = tempDir("module-run-main-watch", {
        "main.cjs": `require("node:module").runMain("./script.cjs");`,
        "script.cjs": version(0),
      });
      const script = path.join(String(dir), "script.cjs");
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...flags.split(" "), "main.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });

      const decoder = new TextDecoder();
      let stderr = "";
      let finished = 0;
      let written = 0;
      for await (const chunk of proc.stderr) {
        stderr += decoder.decode(chunk, { stream: true });
        const done = stderr.match(/^done \d+$/gm) ?? [];
        if (done.length === finished) continue;
        finished = done.length;
        const latest = Number(done.at(-1).slice("done ".length));
        if (latest === 2) break;
        // A reload that ran an older version is not the one for the last write: save it again.
        if (latest === written) written++;
        fs.writeFileSync(script, version(written));
      }
      const alive = proc.exitCode === null && proc.signalCode === null;

      // A save can reload more than once, so a run can repeat: the first of each line counts.
      const said = [...new Set(stderr.match(/^(run \d+|error: failure \d+|done \d+)$/gm))];
      expect({ said, alive }).toEqual({
        said: [0, 1, 2].flatMap(n => [`run ${n}`, `error: failure ${n}`, `done ${n}`]),
        alive: true,
      });
    },
  );
});
