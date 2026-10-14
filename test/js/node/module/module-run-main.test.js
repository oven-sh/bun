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
  const scripts = Object.fromEntries(Object.entries(failing).map(([name, [source]]) => [name, source]));
  const listeners = `
    process.on("uncaughtException", (error, origin) => console.log(origin + ": " + error.message));
    process.on("unhandledRejection", error => console.log("unhandledRejection listener: " + error.message));
    process.on("exit", code => console.log("exit " + code));
  `;

  // Runs bun in a directory that has the scripts and `files`. `stderr` is every line of it that is
  // not the code frame, the stack or the version line of a report.
  async function run(files, ...args) {
    using dir = tempDir("module-run-main", { ...scripts, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const said = stderr
      .split("\n")
      .filter(line => line && !/^\s*(\d+ \| |\^$|at )|^Bun v/.test(line))
      .map(line => line.replace(/ from '.*'$/, ""));
    return { stdout, stderr: said, exitCode };
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
      "--eval",
      {},
      ["--eval", `require("node:module").runMain("./rejects.mjs");`],
      { stdout: "", stderr: ["error: from rejects.mjs"], exitCode: 1 },
    ],
    [
      "a preload",
      { "preload.cjs": `require("node:module").runMain("./throws.cjs");`, "main.cjs": `console.log("main ran");` },
      ["--require", "./preload.cjs", "main.cjs"],
      { stdout: "main ran\n", stderr: ["error: from throws.cjs"], exitCode: 1 },
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
      "a preload that sets a Module.runMain that starts nothing, and starts the main file itself",
      {
        "preload.cjs": override(`() => {}`) + `runMain(process.argv[1]);`,
        "main.cjs": `throw new Error("from main.cjs");`,
      },
      ["--require", "./preload.cjs", "main.cjs"],
      { stdout: "", stderr: ["error: from main.cjs"], exitCode: 1 },
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
  ])("called from %s", async (_, files, args, expected) => {
    expect(await run(files, ...args)).toEqual(expected);
  });

  test.each(["none", "warn"])("with --unhandled-rejections=%s", async mode => {
    const main = `require("node:module").runMain("./throws.mjs");`;
    expect(await run({ "main.cjs": main }, `--unhandled-rejections=${mode}`, "main.cjs")).toEqual({
      stdout: "",
      stderr: ["error: from throws.mjs"],
      exitCode: 1,
    });
  });

  test("is an uncaught exception with the origin unhandledRejection", async () => {
    const main = `${listeners} require("node:module").runMain("./throws.mjs");`;
    expect(await run({ "main.cjs": main }, "main.cjs")).toEqual({
      stdout: "unhandledRejection: from throws.mjs\nexit 0\n",
      stderr: [],
      exitCode: 0,
    });
  });

  test("is not for a listener for unhandled rejections", async () => {
    const main = `
      process.on("unhandledRejection", error => console.log("unhandledRejection listener: " + error.message));
      process.on("exit", code => console.log("exit " + code));
      require("node:module").runMain("./throws.mjs");
    `;
    expect(await run({ "main.cjs": main }, "main.cjs")).toEqual({
      stdout: "exit 1\n",
      stderr: ["error: from throws.mjs"],
      exitCode: 1,
    });
  });

  test.each([
    ["runs after the call returns", "prints.mjs", { stdout: "before\nafter\nscript\n", stderr: [], exitCode: 0 }],
    [
      "is not caught by the caller when it throws",
      "throws.mjs",
      { stdout: "before\nafter\n", stderr: ["error: from throws.mjs"], exitCode: 1 },
    ],
  ])("an ES module %s", async (_, script, expected) => {
    const main = `
      console.log("before");
      try {
        require("node:module").runMain("./${script}");
      } catch {
        console.log("caught");
      }
      console.log("after");
    `;
    expect(await run({ "main.cjs": main, "prints.mjs": `console.log("script");` }, "main.cjs")).toEqual(expected);
  });

  test("a second call for a script that failed reports it again", async () => {
    const main = `
      const Module = require("node:module");
      let calls = 0;
      process.on("uncaughtException", (error, origin) => {
        console.log(origin + ": " + error.message);
        if (++calls === 1) Module.runMain("./throws.mjs");
      });
      process.on("unhandledRejection", error => console.log("unhandledRejection listener: " + error.message));
      Module.runMain("./throws.mjs");
    `;
    expect(await run({ "main.cjs": main }, "main.cjs")).toEqual({
      stdout: "unhandledRejection: from throws.mjs\nunhandledRejection: from throws.mjs\n",
      stderr: [],
      exitCode: 0,
    });
  });

  // Whoever loads a module reports it: a call for a module that runs, or ran, starts nothing.
  const preloadFor = key => `
    process.on("uncaughtException", error => console.log("uncaughtException: " + error.message));
    require("node:module").runMain(${key});
  `;
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
      {
        "preload.cjs": preloadFor(`process.argv[1]`),
        "main.cjs": `console.log("main ran"); throw new Error("from main");`,
      },
      ["--require", "./preload.cjs", "main.cjs"],
      "main ran\nuncaughtException: from main\n",
    ],
    [
      'a preload that calls it for "bun:main"',
      {
        "preload.cjs": preloadFor(`"bun:main"`),
        "main.cjs": `console.log("main ran"); throw new Error("from main");`,
      },
      ["--require", "./preload.cjs", "main.cjs"],
      "main ran\nuncaughtException: from main\n",
    ],
    [
      "a module that require() loaded",
      {
        "main.cjs": `${listeners} require("./required.cjs"); require("node:module").runMain("./required.cjs");`,
        "required.cjs": `console.log("required ran");`,
      },
      ["main.cjs"],
      "required ran\nexit 0\n",
    ],
  ])("%s is run and reported once", async (_, files, args, stdout) => {
    expect(await run(files, ...args)).toEqual({ stdout, stderr: [], exitCode: 0 });
  });

  test("a preload that calls it for the entry point, and then sets a Module.runMain, runs the entry point", async () => {
    const files = {
      "preload.cjs": `
        const Module = require("node:module");
        Module.runMain(process.argv[1]);
        Module.runMain = () => {};
      `,
      "main.cjs": `console.log("main ran");`,
    };
    expect(await run(files, "--require", "./preload.cjs", "main.cjs")).toEqual({
      stdout: "main ran\n",
      stderr: [],
      exitCode: 0,
    });
  });

  test("with --hot, every reload reports it and the process keeps running", async () => {
    const version = n => `console.log("run ${n}"); throw new Error("failure ${n}");`;
    using dir = tempDir("module-run-main-hot", {
      "main.cjs": `require("node:module").runMain("./script.cjs");`,
      "script.cjs": version(0),
    });
    const script = path.join(String(dir), "script.cjs");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    // The script prints before it throws, so every run shows on stdout, reported or not.
    const decoder = new TextDecoder();
    let stdout = "";
    let written = 0;
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk, { stream: true });
      const runs = stdout.match(/^run \d+$/gm);
      if (!runs) continue;
      const latest = Number(runs.at(-1).slice("run ".length));
      if (latest === 3) break;
      // A reload that ran an older version is not the one for the last write: save it again.
      if (latest === written) written++;
      fs.writeFileSync(script, version(written));
    }
    proc.kill();
    const stderr = await proc.stderr.text();

    expect(stdout).toContain("run 3");
    expect(stderr.match(/^error: failure [012]$/gm) ?? []).toEqual(
      expect.arrayContaining(["error: failure 0", "error: failure 1", "error: failure 2"]),
    );
  });
});
