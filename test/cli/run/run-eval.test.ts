import { SyncSubprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tmpdirSync } from "harness";
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
});

// `--print` looks at the result once the event loop is done. A result promise
// that is still pending when the loop drained on its own gets one more turn of
// the loop; one left pending because an unhandled error stopped the loop does
// not (nothing of the script runs after such an error, as with `-e`). Either
// way the process then leaves through the regular exit path ('exit' listeners,
// exit code), not from inside a reaction on the promise.
//
// Every script below arms the timer that would settle the result and then
// blocks in Bun.sleepSync, so the timer is overdue by the time the loop is
// looked at: it fires for sure in the extra turn of the unref cases, and its
// callback not having run in the error cases shows that nothing ran after the
// error, whatever the timing.
describe.concurrent("--print with a result promise still pending when the event loop is done", () => {
  const exitListener = `process.on("exit", () => console.log("exit listener ran"));`;

  async function print(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--print", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("fulfilled by an unref'd timer: prints the value, then runs 'exit' listeners", async () => {
    const { stdout, stderr, exitCode } = await print(
      `${exitListener}
       new Promise(resolve => { setTimeout(() => resolve("settled late"), 1).unref(); Bun.sleepSync(10); })`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("settled late\nexit listener ran\n");
    expect(exitCode).toBe(0);
  });

  test("rejected by an unref'd timer: reported as unhandled and exits 1, like a rejection during the loop", async () => {
    const { stdout, stderr, exitCode } = await print(
      `${exitListener}
       new Promise((_, reject) => { setTimeout(() => reject("rejected late"), 1).unref(); Bun.sleepSync(10); })`,
    );
    expect(stderr).toContain("error: rejected late");
    // What a rejected result is printed as is not this block's subject.
    expect(stdout).toEndWith("exit listener ran\n");
    expect(exitCode).toBe(1);
  });

  test.each(["resolve", "reject"])(
    "unhandled rejection stopped the loop: the %s() timer does not run, exits 1 after 'exit' listeners",
    async settle => {
      const { stdout, stderr, exitCode } = await print(
        `${exitListener}
         Promise.reject(new Error("early rejection"));
         new Promise((resolve, reject) => {
           setTimeout(() => { console.log("timer ran"); ${settle}("late"); }, 1);
           Bun.sleepSync(10);
         })`,
      );
      expect(stderr).toContain("early rejection");
      expect(stdout).toBe("Promise { <pending> }\nexit listener ran\n");
      expect(exitCode).toBe(1);
    },
  );

  test("uncaught exception from a timer stopped the loop: 'exit' listeners see code 1", async () => {
    // The settling timer is armed by the throwing callback itself. Whether the
    // turn of the loop that ran the throw still fires it differs by platform
    // (libuv runs timers again after its poll), so what gets printed is not
    // asserted, only that the process left through the exit listeners.
    const { stdout, stderr, exitCode } = await print(
      `process.on("exit", code => console.log("exit listener ran with", code));
       new Promise(resolve => {
         setTimeout(() => {
           setTimeout(() => resolve("settled late"), 1);
           Bun.sleepSync(10);
           throw new Error("thrown in timer");
         }, 1);
       })`,
    );
    expect(stderr).toContain("thrown in timer");
    expect(stdout).toEndWith("exit listener ran with 1\n");
    expect(exitCode).toBe(1);
  });

  test("never settles: prints the promise and exits normally", async () => {
    const { stdout, stderr, exitCode } = await print(`${exitListener} new Promise(() => {})`);
    expect(stderr).toBe("");
    expect(stdout).toBe("Promise { <pending> }\nexit listener ran\n");
    expect(exitCode).toBe(0);
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
