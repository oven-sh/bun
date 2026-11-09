import { SyncSubprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { tmpdir } from "os";
import { join, sep } from "path";

for (const flag of ["-e", "--print"]) {
  describe(`bun ${flag}`, () => {
    test("it works", async () => {
      const input = flag === "--print" ? '"hello world"' : 'console.log("hello world")';
      let { stdout } = Bun.spawnSync({
        cmd: [bunExe(), flag, input],
        env: bunEnv,
      });
      expect(stdout.toString("utf8")).toEqual("hello world\n");
    });

    test("import, tsx, require in esm, import.meta", async () => {
      const ref = await import("react");
      const input =
        flag === "--print"
          ? 'import {version} from "react"; console.log(JSON.stringify({version,file:import.meta.path,require:require("react").version})); <hello>world</hello>'
          : 'import {version} from "react"; console.log(JSON.stringify({version,file:import.meta.path,require:require("react").version})); console.log(<hello>world</hello>);';

      let { stdout } = Bun.spawnSync({
        cmd: [bunExe(), flag, input],
        env: bunEnv,
      });
      const json = {
        version: ref.version,
        file: join(process.cwd(), "[eval]"),
        require: ref.version,
      };
      expect(stdout.toString("utf8")).toEqual(JSON.stringify(json) + "\n<hello>world</hello>\n");
    });

    test("error has source map info 1", async () => {
      let { stderr } = Bun.spawnSync({
        cmd: [bunExe(), flag, '(throw new Error("hi" as 2))'],
        env: bunEnv,
      });
      expect(stderr.toString("utf8")).toInclude('"hi" as 2');
      expect(stderr.toString("utf8")).toInclude("Unexpected throw");
    });

    test("process.argv", async () => {
      function testProcessArgv(args: string[], expected: string[]) {
        const input = flag === "--print" ? "process.argv" : "console.log(process.argv)";
        let { stdout, stderr, exitCode } = Bun.spawnSync({
          cmd: [bunExe(), flag, input, ...args],
          env: bunEnv,
        });

        expect(stderr.toString("utf8")).toBe("");
        expect(JSON.parse(stdout.toString("utf8"))).toEqual(expected);
        expect(exitCode).toBe(0);
      }

      // replace the trailin
      const exe = isWindows ? bunExe().replaceAll("/", "\\") : bunExe();
      testProcessArgv([], [exe]);
      testProcessArgv(["abc", "def"], [exe, "abc", "def"]);
      testProcessArgv(["--", "abc", "def"], [exe, "abc", "def"]);
      // testProcessArgv(["--", "abc", "--", "def"], [exe, "abc", "--", "def"]);
    });

    test("process._eval", async () => {
      const code = flag === "--print" ? "process._eval" : "console.log(process._eval)";
      const { stdout } = Bun.spawnSync({
        cmd: [bunExe(), flag, code],
        env: bunEnv,
      });
      expect(stdout.toString("utf8")).toEqual(code + "\n");
    });

    // The eval source is UTF-8; reading it back as Latin-1 turns every
    // multi-byte character into mojibake. The expected text is compared here
    // in the parent -- comparing inside the child would pass either way, since
    // a Latin-1-decoded source corrupts the literal and process._eval alike.
    test("process._eval round-trips multi-byte UTF-8", async () => {
      const marker = "/* 한글-🎉-café */";
      const code = (flag === "--print" ? "process._eval" : "console.log(process._eval)") + ` ${marker}`;
      const { stdout } = Bun.spawnSync({
        cmd: [bunExe(), flag, code],
        env: bunEnv,
      });
      expect(stdout.toString("utf8")).toEqual(code + "\n");
    });

    test("does not crash in non-latin1 directory", async () => {
      const dir = join(tmpdirSync(), "eval-test-开始学习");
      await Bun.write(join(dir, "index.js"), "console.log('hello world')");

      const { stdout, stderr, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), flag, "import './index.js'"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      expect(stderr.toString("utf8")).toBe("");
      expect(stdout.toString("utf8")).toEqual("hello world\n" + (flag === "--print" ? "undefined\n" : ""));
      expect(exitCode).toBe(0);
    });
  });
}

describe("--print for cjs/esm", () => {
  test("eval result between esm imports", async () => {
    let cwd = tmpdirSync();
    writeFileSync(join(cwd, "foo.js"), "'foo'");
    writeFileSync(join(cwd, "bar.js"), "'bar'");
    let { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--print", 'import "./foo.js"; 123; import "./bar.js"'],
      cwd: cwd,
      env: bunEnv,
    });
    expect(stderr.toString("utf8")).toBe("");
    expect(stdout.toString("utf8")).toEqual("123\n");
    expect(exitCode).toBe(0);
    rmSync(cwd, { recursive: true, force: true });
  });
  // https://github.com/oven-sh/bun/issues/30207
  describe.each([
    { expr: "(await 1) + 1", expected: "2" },
    { expr: 'await Promise.resolve("hello") + " world"', expected: "hello world" },
    { expr: "(await 1) + (await 2)", expected: "3" },
    // no top-level await — still returns the expression value.
    { expr: "1 + 1", expected: "2" },
  ])("bun -p $expr", ({ expr, expected }) => {
    test(`→ ${expected}`, async () => {
      const { stdout, stderr, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "-p", expr],
        env: bunEnv,
      });
      expect(stderr.toString("utf8")).toBe("");
      expect(stdout.toString("utf8")).toBe(`${expected}\n`);
      expect(exitCode).toBe(0);
    });
  });
  test("forced cjs", async () => {
    let { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--print", "module.exports; 123"],
      env: bunEnv,
    });
    expect(stderr.toString("utf8")).toBe("");
    expect(stdout.toString("utf8")).toEqual("123\n");
    expect(exitCode).toBe(0);
  });
  test("module, exports, require, __filename, __dirname", async () => {
    let { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [
        bunExe(),
        "--print",
        `
        console.log(typeof module, typeof exports, typeof require, typeof __filename, typeof __dirname); 123
      `,
      ],
      env: bunEnv,
    });
    expect(stderr.toString("utf8")).toBe("");
    expect(stdout.toString("utf8")).toEqual("object object function string string\n123\n");
    expect(exitCode).toBe(0);
  });
  test("module._compile is require('module').prototype._compile", async () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "-p", "module._compile === require('module').prototype._compile"],
      env: bunEnv,
    });
    expect(stdout.toString()).toBe("true\n");
    expect(exitCode).toBe(0);
  });

  // The hoist patterns in [install] are regexes. Compiling them while
  // bunfig.toml loaded initialized JSC before `bun -p` could turn on eval
  // mode, so the script's completion value was dropped and every --print
  // printed undefined.
  describe.each(["hoistPattern", "publicHoistPattern"])("with install.%s in bunfig.toml", key => {
    test.concurrent.each([
      { expr: "Math.max(1, 9)", expected: "9" },
      { expr: "[1, 2].map(x => x * 2)", expected: "[ 2, 4 ]" },
      { expr: "1 + 1", expected: "2" },
      { expr: "(await 1) + 1", expected: "2" },
    ])("bun -p $expr", async ({ expr, expected }) => {
      using dir = tempDir("eval-install-pattern", {
        "bunfig.toml": `[install]\n${key} = ["*eslint*", "!eslint-plugin-*"]\n`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-p", expr],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(`${expected}\n`);
      expect(exitCode).toBe(0);
    });
  });
});

async function print(script: string, flag = "-p") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), flag, script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The timer is unref'd and already due when the event loop drains, so the result is still pending then.
const settlesLate = (settle: "resolve" | "reject", value: string) =>
  `new Promise((resolve, reject) => { setTimeout(() => ${settle}(${value}), 1).unref(); Bun.sleepSync(10); })`;

describe.concurrent("--print of a result that throws while it is formatted", () => {
  const thrower = `({ [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("inspect failed"); } })`;
  const reported = { stdout: "", stderr: expect.stringContaining("error: inspect failed"), exitCode: 1 };

  describe.each(["-p", "--print"])("%s", flag => {
    test.each([
      ["a value", thrower],
      ["a settled promise", `Promise.resolve(${thrower})`],
      ["a top-level await", `await new Promise(resolve => setTimeout(() => resolve(${thrower}), 1))`],
      ["a promise fulfilled late", settlesLate("resolve", thrower)],
      ["a promise rejected late", settlesLate("reject", thrower)],
    ])("%s", async (_, script) => {
      expect(await print(script, flag)).toEqual(reported);
    });
  });

  test("exit listeners see exit code 1", async () => {
    const script = `process.exitCode = 5; process.on("exit", code => console.log("exit", code)); ${thrower}`;
    expect(await print(script)).toEqual({ ...reported, stdout: "exit 1\n" });
  });

  test("an immediate from the callback that settled the result does not run after the throw", async () => {
    const result = settlesLate("resolve", `(setImmediate(() => process.exit(0)), ${thrower})`);
    expect(await print(result)).toEqual(reported);
  });

  test.each([
    ["a value", thrower],
    ["a promise fulfilled late", settlesLate("resolve", thrower)],
  ])("an uncaughtException listener gets the error of %s", async (_, result) => {
    const script = `
      process.on("uncaughtException", (error, origin) => {
        console.log(origin, error.message);
        setTimeout(() => console.log("timer ran"), 1);
      });
      process.on("exit", code => console.log("exit", code));
      ${result}`;
    expect(await print(script)).toEqual({
      stdout: "uncaughtException inspect failed\ntimer ran\nexit 0\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Node runs the listener before it prints, so stdout is not asserted.
  test("a beforeExit listener that logs does not crash", async () => {
    const { stderr, exitCode } = await print(`process.on("beforeExit", () => console.log("beforeExit")); ${thrower}`);
    expect({ stderr, exitCode }).toEqual({ stderr: reported.stderr, exitCode: 1 });
  });

  test("a timer that the hook starts before it throws does not crash", async () => {
    const hook = `setTimeout(() => console.log("timer ran"), 5); throw new Error("inspect failed");`;
    expect(await print(`({ [Symbol.for("nodejs.util.inspect.custom")]() { ${hook} } })`)).toEqual(reported);
  });

  // The error printer returns normally here and leaves the exception on the VM.
  test("an Error with a property that throws", async () => {
    const source = `Object.defineProperty(/a/, "source", { get() { throw new Error("inner failed"); } })`;
    const { stderr, exitCode } = await print(`Object.assign(new Error("outer"), { property: ${source} })`);
    expect({ stderr, exitCode }).toEqual({ stderr: expect.stringContaining("error: inner failed"), exitCode: 1 });
  });
});

describe.concurrent("--print of a promise that is pending when the event loop drains", () => {
  const exitListener = `process.on("exit", () => console.log("exit listener ran"));`;

  test("fulfilled late: the value is printed, then beforeExit and exit listeners run", async () => {
    const script = `
      process.on("beforeExit", () => console.log("beforeExit"));
      process.on("exit", code => console.log("exit", code));
      ${settlesLate("resolve", `"RESULT"`)}`;
    expect(await print(script)).toEqual({ stdout: "RESULT\nbeforeExit\nexit 0\n", stderr: "", exitCode: 0 });
  });

  test("fulfilled late by a timer that starts a ref'd timer: the value is printed, then that timer runs", async () => {
    const script = `
      ${exitListener}
      new Promise(resolve => {
        setTimeout(() => { setTimeout(() => console.log("second timer ran"), 20); resolve("RESULT"); }, 1).unref();
        Bun.sleepSync(10);
      })`;
    expect(await print(script)).toEqual({
      stdout: "RESULT\nsecond timer ran\nexit listener ran\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The fs task settles the result inside a tick. The poll after that tick waits for the timer.
  test("fulfilled late by a task that starts a ref'd timer: the value is printed before the poll", async () => {
    const script = `
      ${exitListener}
      new Promise(resolve => {
        const later = () => { setTimeout(() => console.log("second timer ran"), 1); return "RESULT"; };
        setTimeout(() => resolve(require("fs").promises.stat(".").then(later)), 1).unref();
        Bun.sleepSync(10);
      })`;
    expect(await print(script)).toEqual({
      stdout: "RESULT\nsecond timer ran\nexit listener ran\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Whether the due timer runs is a race in a real script, so it does not decide the exit code.
  // The vendored test-timers-*-promisified.js files run -p on the then() shape.
  test.each([
    ["by its executor", settlesLate("reject", `"REASON"`)],
    ["from a then() callback", `${settlesLate("resolve", "1")}.then(() => { throw "REASON"; })`],
    ["by a timer that also starts a ref'd timer", settlesLate("reject", `(setTimeout(() => {}, 1), "REASON")`)],
    // The fs callback is a task. The tick that runs it reports unhandled rejections before it returns.
    [
      "by a task",
      `new Promise((resolve, reject) => {
        setTimeout(() => require("fs").stat(".", () => reject("REASON")), 1).unref();
        Bun.sleepSync(10);
      })`,
    ],
  ])("rejected late %s: the reason is printed and the exit code is 0", async (_, result) => {
    expect(await print(`${exitListener} ${result}`)).toEqual({
      stdout: "REASON\nexit listener ran\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The extra turn ends with the result still pending. Nothing else reports what it settles to afterwards.
  test.each(["resolve", "reject"])(
    "settled by a timer that a beforeExit listener starts: printed as pending, then what %s() got",
    async settle => {
      const script = `
        let settle;
        const result = new Promise((resolve, reject) => { settle = ${settle}; });
        process.once("beforeExit", () => setTimeout(() => settle("LATE"), 1));
        process.on("exit", code => console.log("exit", code));
        result`;
      expect(await print(script)).toEqual({
        stdout: "Promise { <pending> }\nLATE\nexit 0\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // The error ends the loop with the timer still ref'd. Nothing of the script runs after it.
  test.each(["resolve", "reject"])("after an unhandled rejection the %s() timer does not run", async settle => {
    const script = `
      ${exitListener}
      Promise.reject(new Error("early rejection"));
      new Promise((resolve, reject) => {
        setTimeout(() => { console.log("timer ran"); ${settle}("late"); }, 1);
        Bun.sleepSync(10);
      })`;
    expect(await print(script)).toEqual({
      stdout: "Promise { <pending> }\nexit listener ran\n",
      stderr: expect.stringContaining("error: early rejection"),
      exitCode: 1,
    });
  });

  test("after an unhandled rejection a timer that calls process.exit(0) does not run", async () => {
    const script = `Promise.reject(new Error("early rejection")); setTimeout(() => process.exit(0), 20); new Promise(() => {})`;
    expect(await print(script)).toEqual({
      stdout: "Promise { <pending> }\n",
      stderr: expect.stringContaining("error: early rejection"),
      exitCode: 1,
    });
  });
});

function group(run: (code: string) => SyncSubprocess<"pipe", "inherit">) {
  test("it works", async () => {
    const { stdout } = run('console.log("hello world")');
    expect(stdout.toString("utf8")).toEqual("hello world\n");
  });

  test("it gets a correct specifer", async () => {
    const { stdout } = run("console.log(import.meta.path)");
    expect(stdout.toString("utf8")).toEndWith(sep + "[stdin]\n");
  });

  test("it can require", async () => {
    const { stdout } = run(`
        const process = require("node:process");
        console.log(process.platform);
      `);
    expect(stdout.toString("utf8")).toEqual(process.platform + "\n");
  });

  test("it can import", async () => {
    const { stdout } = run(`
        import * as process from "node:process";
        console.log(process.platform);
      `);
    expect(stdout.toString("utf8")).toEqual(process.platform + "\n");
  });

  test("process.argv", async () => {
    const { stdout } = run("console.log(process.argv)");
    const exe = isWindows ? bunExe().replaceAll("/", "\\") : bunExe();
    expect(JSON.parse(stdout.toString("utf8"))).toEqual([exe, "-"]);
  });

  test("process._eval", async () => {
    const code = "console.log(process._eval)";
    const { stdout } = run(code);

    // the file piping one on windows can include extra carriage returns
    if (isWindows) {
      expect(stdout.toString("utf8")).toInclude(code);
    } else {
      expect(stdout.toString("utf8")).toEqual(code + "\n");
    }
  });
}

describe("bun run - < file-path.js", () => {
  function run(code: string) {
    // bash only supports / as path separator
    const file = join(tmpdir(), "bun-run-eval-test.js").replaceAll("\\", "/");
    require("fs").writeFileSync(file, code);
    try {
      let result;
      if (process.platform === "win32") {
        result = Bun.spawnSync(["powershell", "-c", `Get-Content ${file} | ${bunExe()} run -`], {
          env: bunEnv,
          stderr: "inherit",
        });
      } else {
        result = Bun.spawnSync(["bash", "-c", `${bunExe()} run - < ${file}`], {
          env: bunEnv,
          stderr: "inherit",
        });
      }

      if (!result.success) {
        queueMicrotask(() => {
          throw new Error("bun run - < file-path.js failed");
        });
      }

      return result;
    } finally {
      try {
        require("fs").unlinkSync(file);
      } catch (e) {}
    }
  }

  group(run);
});

describe("echo | bun run -", () => {
  function run(code: string) {
    const result = Bun.spawnSync([bunExe(), "run", "-"], {
      env: bunEnv,
      stdin: Buffer.from(code),
      stderr: "inherit",
    });
    if (!result.success) {
      queueMicrotask(() => {
        throw new Error("bun run - failed");
      });
    }

    return result;
  }

  group(run);
});

test("process._eval (undefined for normal run)", async () => {
  const cwd = tmpdirSync();
  const file = join(cwd, "test.js");
  writeFileSync(file, "console.log(typeof process._eval)");

  const { stdout } = Bun.spawnSync({
    cmd: [bunExe(), "run", file],
    cwd: cwd,
    env: bunEnv,
  });
  expect(stdout.toString("utf8")).toEqual("undefined\n");

  rmSync(cwd, { recursive: true, force: true });
});

test("uncaught error from a CommonJS-sniffed eval entry reports and exits 1", async () => {
  // The presence of require() makes the eval source evaluate as CommonJS,
  // which used to swallow a top-level throw entirely: no stderr output and
  // exit code 0.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `require("assert"); throw new Error("eval-cjs-uncaught");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("eval-cjs-uncaught");
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});

test("uncaught error from a CommonJS-sniffed stdin entry reports and exits 1", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-"],
    env: bunEnv,
    stdin: Buffer.from(`require("assert"); throw new Error("stdin-cjs-uncaught");`),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("stdin-cjs-uncaught");
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});
