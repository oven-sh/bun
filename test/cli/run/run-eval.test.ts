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

async function runIn(cwd: string, args: string[], stdin?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: bunEnv,
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A CommonJS `-e` / stdin program runs as a script, with `require`, `module`, `exports`, `__filename`
// and `__dirname` as globals and no wrapper function around it. A script cannot say `import.meta`
// ("SyntaxError: import.meta is only valid inside modules."), so the program reads it from a global too.
describe("import.meta in a CommonJS eval program", () => {
  // Each of these alone makes the parser call the program CommonJS.
  const rest = "typeof import.meta.url, import.meta.main";
  const programs = [
    { uses: "require", code: `console.log(typeof require, ${rest})`, expected: "function string true\n" },
    { uses: "module", code: `console.log(typeof module, ${rest})`, expected: "object string true\n" },
    { uses: "exports", code: `console.log(typeof exports, ${rest})`, expected: "object string true\n" },
    { uses: "__filename", code: `console.log(typeof __filename, ${rest})`, expected: "string string true\n" },
    { uses: "__dirname", code: `console.log(typeof __dirname, ${rest})`, expected: "string string true\n" },
    { uses: '"use strict"', code: `"use strict"; console.log("strict", ${rest})`, expected: "strict string true\n" },
    { uses: "with", code: `with ({}) console.log("with", ${rest})`, expected: "with string true\n" },
  ];
  // The program has no module type and is transpiled as a .tsx file is, so the same text in one is
  // what it must print.
  const ways: Record<string, (code: string) => { args: string[]; stdin?: string; completion?: string }> = {
    "a .tsx file": () => ({ args: ["program.tsx"] }),
    "-e": code => ({ args: ["-e", code] }),
    "--print": code => ({ args: ["--print", code], completion: "undefined\n" }),
    "bun -": code => ({ args: ["-"], stdin: code }),
    "bun run -": code => ({ args: ["run", "-"], stdin: code }),
  };
  describe.each(programs)("in a program with $uses", ({ code, expected }) => {
    test.concurrent.each(Object.keys(ways))("%s", async way => {
      using dir = tempDir("eval-cjs-import-meta", { "program.tsx": code });
      const { args, stdin, completion = "" } = ways[way](code);
      expect(await runIn(String(dir), args, stdin)).toEqual({ stdout: expected + completion, stderr: "", exitCode: 0 });
    });
  });

  test.concurrent("is the program's own, also in a callback that runs later", async () => {
    using dir = tempDir("eval-cjs-import-meta", {});
    const code = `
      const first = import.meta;
      console.log(typeof require, first.file, first.main);
      queueMicrotask(() => console.log(import.meta === first));
    `;
    expect(await runIn(String(dir), ["-e", code])).toEqual({
      stdout: "function [eval] true\ntrue\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await runIn(String(dir), ["-"], code)).toEqual({
      stdout: "function [stdin] true\ntrue\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("is there each time the program is evaluated", async () => {
    using dir = tempDir("eval-cjs-import-meta", {});
    const code = `
      globalThis.runs = (globalThis.runs ?? 0) + 1;
      console.log(runs, typeof module, import.meta.file);
      if (runs < 3) {
        delete require.cache[__filename];
        require(__filename);
      }
    `;
    expect(await runIn(String(dir), ["-e", code])).toEqual({
      stdout: "1 object [eval]\n2 object [eval]\n3 object [eval]\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The global is there when the transpiled text can read it. The parser prints `import.meta.main`
  // as `require.main == module` and `import.meta.hot` as `undefined`, and a define replaces the
  // whole expression: such programs ran before, and get no global. Dead code counts as a reader.
  describe("is a global, not enumerable, only for a program whose text reads it", () => {
    const names = `JSON.stringify([Object.getOwnPropertyNames(globalThis), Object.keys(globalThis)].map(names => names.filter(name => name.includes("import_meta"))))`;
    const none = "[[],[]]";
    const one = '[["$Bun_eval_import_meta"],[]]';
    test.concurrent.each([
      { says: "no import.meta", print: `"none"`, expected: `function none ${none}\n` },
      { says: "import.meta.main", print: `import.meta.main`, expected: `function true ${none}\n` },
      { says: "!import.meta.main", print: `!import.meta.main`, expected: `function false ${none}\n` },
      { says: "import.meta.hot", print: `String(import.meta.hot)`, expected: `function undefined ${none}\n` },
      {
        says: "import.meta.hot?.data",
        print: `String(import.meta.hot?.data)`,
        expected: `function undefined ${none}\n`,
      },
      {
        says: "a defined import.meta.env.FOO",
        flags: ["--define", `import.meta.env.FOO="x"`],
        print: `import.meta.env.FOO`,
        expected: `function x ${none}\n`,
      },
      { says: "import.meta.url", print: `typeof import.meta.url`, expected: `function string ${one}\n` },
      {
        says: "import.meta.main and import.meta.url",
        print: `import.meta.main, typeof import.meta.url`,
        expected: `function true string ${one}\n`,
      },
      {
        says: "import.meta.url in dead code",
        before: `if (false) import.meta.url;`,
        print: `"dead"`,
        expected: `function dead ${one}\n`,
      },
    ])("a program that says $says", async ({ flags = [], before = "", print, expected }) => {
      using dir = tempDir("eval-cjs-import-meta", {});
      const code = `${before} console.log(typeof require, ${print}, ${names});`;
      expect(await runIn(String(dir), [...flags, "-e", code])).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    });
  });

  // With a watcher, the loader hands the transpiled program over through another return path.
  test.concurrent.each(["--hot", "--watch"])("%s -e", async flag => {
    using dir = tempDir("eval-cjs-import-meta", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), flag, "-e", `console.log(typeof require, ${rest}); process.exit(0);`],
      cwd: String(dir),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    // An uncaught error does not end a process that watches, so this reads what stderr gets first
    // and does not wait for the exit.
    const { value } = await proc.stderr.getReader().read();
    expect(value ? Buffer.from(value).toString() : "").toBe("");
    expect(await proc.stdout.text()).toBe("function string true\n");
    expect(await proc.exited).toBe(0);
  });

  // --hot evaluates the program again, on the same global, when a file that it required changes.
  test.concurrent("--hot -e evaluates the program again", async () => {
    using dir = tempDir("eval-cjs-import-meta", { "dep.cjs": `module.exports = 1;` });
    const code = `
      globalThis.runs = (globalThis.runs ?? 0) + 1;
      try {
        console.log(runs > 1, typeof require, import.meta.file, require("./dep.cjs"));
      } catch (e) {
        console.log(runs > 1, e.message);
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "-e", code],
      cwd: String(dir),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = proc.stdout.getReader();
    let text = "";
    // The first line of stdout that starts with `prefix`.
    async function line(prefix: string) {
      for (;;) {
        const found = text
          .split("\n")
          .slice(0, -1)
          .find(line => line.startsWith(prefix));
        if (found !== undefined) return found;
        const { value, done } = await stdout.read();
        if (done) return text;
        text += Buffer.from(value).toString();
      }
    }
    // An uncaught error does not end the process. It is a line on stderr, and that ends each wait.
    // A debug build reports each reload there too, as "DEBUG: ...".
    const failed = (async () => {
      let errors = "";
      for await (const chunk of proc.stderr) {
        errors += Buffer.from(chunk).toString();
        const lines = errors
          .split("\n")
          .slice(0, -1)
          .filter(line => line && !line.startsWith("DEBUG: "));
        if (lines.length > 0) return lines.join("\n");
      }
      return await new Promise<string>(() => {});
    })();
    expect(await Promise.race([line("false"), failed])).toBe("false function [eval] 1");
    // The same length, in place, so that the program never sees a half-written file.
    writeFileSync(join(String(dir), "dep.cjs"), `module.exports = 2;`, { flag: "r+" });
    expect(await Promise.race([line("true"), failed])).toBe("true function [eval] 2");
  });
});

// The transpiler says on the source whether CommonJS text is a wrapper function to call or the
// `-e` / stdin program to run as a script. The evaluator used to tell by the filename of the module,
// and ran these three as scripts: the wrapper was evaluated and never called.
describe("CommonJS text in a wrapper, under the filename of the eval program", () => {
  test.concurrent("module._compile(source, __filename) calls the wrapper it makes", async () => {
    using dir = tempDir("eval-cjs-wrapper", {});
    const code = `module._compile("module.exports = 42", __filename); console.log(module.exports);`;
    expect(await runIn(String(dir), ["-e", code])).toEqual({ stdout: "42\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("an overridden module._compile gets the whole text of the program", async () => {
    using dir = tempDir("eval-cjs-wrapper", {});
    const code = `var Module = require("module");
if (!globalThis.again) {
  globalThis.again = true;
  module._compile = source => console.log(source.startsWith("var Module"), source.trimEnd().endsWith("}"));
  Module._extensions[".js"](module, __filename);
}`;
    expect(await runIn(String(dir), ["-e", code])).toEqual({ stdout: "true true\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("a `// @bun @bun-cjs` program on stdin runs the body of its wrapper", async () => {
    using dir = tempDir("eval-cjs-wrapper", {});
    const code = `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {console.log("ran", typeof require, typeof module);})`;
    expect(await runIn(String(dir), ["-"], code)).toEqual({ stdout: "ran function object\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("a preloaded Module.wrapper is not put around the program", async () => {
    using dir = tempDir("eval-cjs-wrapper", {
      "preload.cjs": `require("module").wrapper = ["(function (exports, require, module, __filename, __dirname) { ", "\\n});"];`,
      // The transpiler gives this module import.meta as a sixth wrapper parameter, which the wrapper
      // above does not take. The module must not get the program's import.meta in its place.
      "dep.cjs": `module.exports = import.meta.url;`,
    });
    const code = `
      let dep;
      try { dep = require("./dep.cjs"); } catch (e) { dep = e.name; }
      const own = require("url").pathToFileURL(require.resolve("./dep.cjs")).href;
      console.log(import.meta.file, dep === "ReferenceError" || dep === own);
    `;
    expect(await runIn(String(dir), ["-r", "./preload.cjs", "-e", code])).toEqual({
      stdout: "[eval] true\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
