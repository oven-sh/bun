import { SyncSubprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { tmpdir } from "os";
import { join, sep } from "path";
import { inspect } from "util";

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
      // --print formats its result like Node (node:util inspect), while
      // console.log keeps Bun's JSX pretty-printing.
      const trailing =
        flag === "--print"
          ? inspect((ref as any).createElement("hello", null, "world")) + "\n"
          : "<hello>world</hello>\n";
      expect(stdout.toString("utf8")).toEqual(JSON.stringify(json) + "\n" + trailing);
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
        if (flag === "--print") {
          // --print formats with node:util inspect (single quotes), so compare
          // against the same formatting instead of parsing as JSON.
          expect(stdout.toString("utf8")).toBe(inspect(expected) + "\n");
        } else {
          expect(JSON.parse(stdout.toString("utf8"))).toEqual(expected);
        }
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

describe("node-style CLI argument errors", () => {
  // Node exits with code 9 and `<execPath>: <flag> requires an argument` when a
  // flag that needs a value is passed without one. Bun matches that contract for
  // the runtime flags it shares with Node.
  test.each(["-e", "--eval", "-p", "--print", "--inspect-port", "--debug-port"])(
    "%s without a value exits with code 9 and Node's error message",
    flag => {
      const { stdout, stderr, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), flag],
        env: bunEnv,
      });
      expect(stderr.toString("utf8").split(/\r?\n/)[0]).toBe(`${process.execPath}: ${flag} requires an argument`);
      expect(stdout.toString("utf8")).toBe("");
      expect(exitCode).toBe(9);
    },
  );

  test.each(["--inspect-port=", "--debug-port="])("%s (empty value) exits with code 9", flag => {
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), flag],
      env: bunEnv,
    });
    expect(stderr.toString("utf8").split(/\r?\n/)[0]).toBe(`${process.execPath}: ${flag} requires an argument`);
    expect(stdout.toString("utf8")).toBe("");
    expect(exitCode).toBe(9);
  });

  test.each(["--allow-fs-read=*", "--allow-fs-write=*"])("%s without --permission exits with code 1", flag => {
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), flag, "-e", "console.log('ran')"],
      env: bunEnv,
    });
    expect(stderr.toString("utf8")).toContain("--permission is required");
    expect(stdout.toString("utf8")).toBe("");
    expect(exitCode).toBe(1);
  });

  test("--allow-fs-read with --permission does not error at argument parsing", () => {
    // The permission model itself is not implemented; --permission is accepted
    // and ignored (same as before these flags were recognized), so existing
    // scripts that pass it keep running.
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--permission", "--allow-fs-read=*", "-e", "console.log('ran')"],
      env: bunEnv,
    });
    expect(stdout.toString("utf8")).toBe("ran\n");
    expect(exitCode).toBe(0);
  });
});

describe("--check / -c (syntax check)", () => {
  test.each(["--check", "-c"])("%s exits 0 and prints nothing for a valid file", flag => {
    using dir = tempDir("check-good", {
      "good.js": "var foo = 'bar';\nif (foo) {\n  console.log('never runs');\n}\n",
    });
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), flag, join(String(dir), "good.js")],
      env: bunEnv,
    });
    expect(stderr.toString("utf8")).toBe("");
    expect(stdout.toString("utf8")).toBe("");
    expect(exitCode).toBe(0);
  });

  test("does not execute the file", () => {
    using dir = tempDir("check-no-exec", {
      "side-effect.js": "console.log('executed'); process.exitCode = 7;",
    });
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--check", join(String(dir), "side-effect.js")],
      env: bunEnv,
    });
    expect(stdout.toString("utf8")).toBe("");
    expect(exitCode).toBe(0);
  });

  test.each(["--check", "-c"])("%s reports a SyntaxError starting with the file path", flag => {
    using dir = tempDir("check-bad", {
      "bad.js": "var foo bar;\n",
    });
    const file = join(String(dir), "bad.js");
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), flag, file],
      env: bunEnv,
    });
    const errorOutput = stderr.toString("utf8");
    expect(errorOutput.startsWith(file)).toBe(true);
    expect(errorOutput).toMatch(/^SyntaxError: Unexpected identifier\b/m);
    expect(stdout.toString("utf8")).toBe("");
    expect(exitCode).toBe(1);
  });

  test("checks stdin as [stdin]", () => {
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--check"],
      env: bunEnv,
      stdin: Buffer.from("var foo bar;"),
    });
    expect(stderr.toString("utf8").startsWith("[stdin]")).toBe(true);
    expect(stdout.toString("utf8")).toBe("");
    expect(exitCode).toBe(1);
  });

  test("valid stdin exits 0 without running the code", () => {
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--check"],
      env: bunEnv,
      stdin: Buffer.from('throw new Error("should not run");'),
    });
    expect(stderr.toString("utf8")).toBe("");
    expect(stdout.toString("utf8")).toBe("");
    expect(exitCode).toBe(0);
  });

  test("--input-type=module reports the module-parse error", () => {
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--input-type=module", "--check"],
      env: bunEnv,
      stdin: Buffer.from("export var p = 5; var foo bar;"),
    });
    expect(stderr.toString("utf8")).toMatch(/^SyntaxError: Unexpected identifier\b/m);
    expect(exitCode).toBe(1);
  });

  test("top-level return passes (CommonJS wrapper), and -r can override the wrapper", () => {
    using dir = tempDir("check-wrapper", {
      "ret.js": "var x = 1;\nif (x) {\n  return;\n}\n",
      "no-wrapper.js": "require('module').wrapper = ['', ''];\n",
    });
    const file = join(String(dir), "ret.js");

    const ok = Bun.spawnSync({ cmd: [bunExe(), "--check", file], env: bunEnv });
    expect(ok.stderr.toString("utf8")).toBe("");
    expect(ok.exitCode).toBe(0);

    const overridden = Bun.spawnSync({
      cmd: [bunExe(), "--require", join(String(dir), "no-wrapper.js"), "--check", file],
      env: bunEnv,
    });
    expect(overridden.stderr.toString("utf8")).toMatch(/^SyntaxError: /m);
    expect(overridden.exitCode).toBe(1);
  });

  test("missing file reports Cannot find module with exit code 1", () => {
    using dir = tempDir("check-missing", {});
    const file = join(String(dir), "nope.js");
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--check", file],
      env: bunEnv,
    });
    expect(stderr.toString("utf8")).toMatch(/^Error: Cannot find module/m);
    expect(stdout.toString("utf8")).toBe("");
    expect(exitCode).toBe(1);
  });

  test("--check with --eval is rejected with exit code 9", () => {
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "-c", "-e", "foo"],
      env: bunEnv,
    });
    expect(stderr.toString("utf8").split(/\r?\n/)[0]).toBe(
      `${process.execPath}: either --check or --eval can be used, not both`,
    );
    expect(stdout.toString("utf8")).toBe("");
    expect(exitCode).toBe(9);
  });
});
