import { spawnSync } from "bun";
import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { dirname, join } from "path";

let cwd: string | undefined;

describe("bun", () => {
  test("should error with missing script", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "run", "dev"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });

  test("an empty-string script value is not a runnable script", () => {
    using dir = tempDir("empty-script", {
      "package.json": JSON.stringify({ scripts: { build: "" } }),
    });
    // Zig `asPropertyStringMap` drops empty-valued script entries; an empty
    // `build` must report "Script not found" and exit 1, not run an empty
    // `$ ` command and exit 0. (npm runs empty scripts and exits 0 — Bun
    // intentionally diverges here to match its own prior/Zig behavior.)
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: String(dir),
      cmd: [bunExe(), "run", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });
});

// A working directory can be PATH_MAX - 1 bytes long. A file in it whose own path no longer fits a path buffer
// is treated as one that cannot be read.
describe.concurrent.skipIf(!isLinux)("a working directory close to PATH_MAX", () => {
  const PATH_MAX = 4096;
  const packageJson = JSON.stringify({ name: "deep", scripts: { hi: "echo hi" } });

  /** `files` in a directory whose absolute path is exactly `cwdBytes` bytes long, below a `node_modules/.bin/hello`. */
  function deepProject(cwdBytes: number, files: Record<string, string>) {
    const dir = tempDir("run-deep-cwd", { project: files, "node_modules/.bin/hello": "#!/bin/sh\necho hello\n" });
    chmodSync(join(String(dir), "node_modules", ".bin", "hello"), 0o755);
    let cwd = String(dir);
    // The last name has to stay under NAME_MAX (255).
    while (cwdBytes - Buffer.byteLength(cwd) > 256) cwd = join(cwd, Buffer.alloc(200, "d").toString());
    cwd = join(cwd, Buffer.alloc(cwdBytes - Buffer.byteLength(cwd) - 1, "L").toString());
    expect(Buffer.byteLength(cwd)).toBe(cwdBytes);
    // The files may be too long to write by their final paths: the directory is moved there with them inside.
    mkdirSync(dirname(cwd), { recursive: true });
    renameSync(join(String(dir), "project"), cwd);
    return { cwd, [Symbol.dispose]: () => dir[Symbol.dispose]() };
  }

  async function run(cmd: string[], cwd: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  describe.each(["tsconfig.json", "jsconfig.json"])("<cwd>/%s does not fit, <cwd>/package.json does", name => {
    const cwdBytes = PATH_MAX - "/package.json".length;

    test("bun run <script>", async () => {
      using project = deepProject(cwdBytes, { "package.json": packageJson, [name]: "{}" });
      expect(await run(["run", "hi"], project.cwd)).toEqual({ stdout: "hi\n", stderr: "$ echo hi\n", exitCode: 0 });
    });

    test("bunx", async () => {
      using project = deepProject(cwdBytes, { "package.json": packageJson, [name]: "{}" });
      expect(await run(["x", "hello"], project.cwd)).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
    });
  });

  describe.each([
    ["one byte too long", PATH_MAX - "/package.json".length + 1],
    ["as long as it can be", PATH_MAX - 1],
  ])("<cwd>/package.json is %s", (_, cwdBytes) => {
    test("bun run <script>", async () => {
      using project = deepProject(cwdBytes, { "package.json": packageJson });
      expect(await run(["run", "hi"], project.cwd)).toEqual({
        stdout: "",
        stderr: 'error: Script not found "hi"\n',
        exitCode: 1,
      });
    });

    test("bunx", async () => {
      using project = deepProject(cwdBytes, { "package.json": packageJson });
      expect(await run(["x", "hello"], project.cwd)).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
    });
  });
});

// `bun run` takes its scripts from the nearest package.json. Where that file is there and does not parse, `bun run` says
// what is wrong with it, and the scripts of a package further up are not the scripts of this one.
describe.concurrent("a package.json that does not parse", () => {
  const packageJson = (name: string) => JSON.stringify({ name, scripts: { greet: `echo from-${name}` } });
  // The file, and what `bun run` says of it.
  const unparsable: Record<string, [text: string, error: string]> = {
    "a missing brace": [
      `{\n  "name": "child",\n  "scripts": {\n    "greet": "echo from-child"\n  }\n`,
      `5 |   }\n       ^\nerror: Expected "}" but found end of file\n    at <dir>/child/package.json:5:4`,
    ],
    "a missing comma": [
      `{\n  "name": "child"\n  "scripts": {\n    "greet": "echo from-child"\n  }\n}\n`,
      `3 |   "scripts": {\n      ^\nerror: Expected "," but found ""scripts""\n    at <dir>/child/package.json:3:3`,
    ],
    "a conflict marker": [
      `{\n  "name": "child",\n<<<<<<< HEAD\n  "version": "1.0.0",\n=======\n  "version": "1.0.1",\n>>>>>>> theirs\n  "scripts": {\n    "greet": "echo from-child"\n  }\n}\n`,
      `3 | <<<<<<< HEAD\n    ^\nerror: Expected string but found "<<<<<<<"\n    at <dir>/child/package.json:3:1`,
    ],
    "a string that does not end": [
      `{\n  "name": "child,\n  "scripts": {"greet": "echo from-child"}\n}\n`,
      `2 |   "name": "child,\n              ^\nerror: Unterminated string literal\n    at <dir>/child/package.json:2:11`,
    ],
    "a root that is not an object": [`[]`, `error: package.json root must be an object: '<dir>/child/package.json'`],
  };
  const [text, error] = unparsable["a missing brace"];
  const withLine = (line: string) => `${error}\nerror: ${line}`;
  const timed = (stderr: string) => stderr.replace(/Done in [\d.]+ ?m?s/g, "Done in <time>");

  // A package in `child`, in a package that has the same script.
  const project = (child: Record<string, string>) =>
    tempDir("run-unparsable-package-json", {
      "package.json": packageJson("parent"),
      "child/x.js": `console.log("ran");`,
      "child/below/.keep": "",
      ...Object.fromEntries(Object.entries(child).map(([name, text]) => [`child/${name}`, text])),
    });

  async function run(dir: string, cwd: string, args: string[], stdin?: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: join(dir, cwd),
      // Those of the package that runs these tests stay in place otherwise.
      env: { ...bunEnv, npm_package_name: undefined, npm_package_json: undefined },
      stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: normalizeBunSnapshot(stdout, dir), stderr: normalizeBunSnapshot(stderr, dir), exitCode };
  }

  test.each(Object.entries(unparsable))("%s", async (_, [text, error]) => {
    using dir = project({ "package.json": text });
    expect(await run(String(dir), "child", ["run", "greet"])).toEqual({
      stdout: "",
      stderr: `${error}\nerror: Script not found "greet"`,
      exitCode: 1,
    });
  });

  test.each([
    ["child", ["run", "greet"], withLine(`Script not found "greet"`)],
    ["child", ["greet"], withLine(`Script not found "greet"`)],
    // The nearest one is the one of `child`.
    ["child/below", ["run", "greet"], withLine(`Script not found "greet"`)],
    // None is listed, and none is known to be absent.
    ["child", ["run"], error],
    ["child", ["run", "--if-present", "greet"], error],
    ["child", ["--if-present", "greet"], error],
    ["child", ["run", "--if-present", "missing.js"], error],
    // A script can have such a name.
    ["child", ["run", "greet.dev"], withLine(`File not found "greet.dev"`)],
    ["child", ["run", "missing.js"], withLine(`Module not found "missing.js"`)],
  ])("in %s: bun %j", async (cwd, args, stderr) => {
    using dir = project({ "package.json": text });
    expect(await run(String(dir), cwd, args)).toEqual({ stdout: "", stderr, exitCode: 1 });
  });

  // `--parallel` and `--sequential` give a name that is no script and no file to the shell, which does not find it.
  // The shell is Bun's on Windows.
  test.each(["--parallel", "--sequential"])("bun run %s: the script further up does not run", async flag => {
    using dir = project({ "package.json": text });
    const { stdout, stderr, exitCode } = await run(String(dir), "child", ["run", flag, "greet"]);
    expect(stderr).toStartWith(error + "\n");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: isWindows ? 1 : 127 });
  });

  test("bun run --parallel: a pattern matches no script", async () => {
    using dir = project({ "package.json": text });
    expect(await run(String(dir), "child", ["run", "--parallel", "gre*"])).toEqual({
      stdout: "",
      stderr: withLine(`Cannot use glob pattern "gre*" without package.json scripts`),
      exitCode: 1,
    });
  });

  test("bun run --parallel: a command still runs", async () => {
    using dir = project({ "package.json": text });
    const { stdout, stderr, exitCode } = await run(String(dir), "child", ["run", "--parallel", "echo raw"]);
    expect({ stdout, stderr: timed(stderr), exitCode }).toEqual({
      stdout: "echo raw | raw",
      stderr: `${error}\necho raw | Done in <time>`,
      exitCode: 0,
    });
  });

  test("what is wrong with another file is not said", async () => {
    using dir = project({ "package.json": text, "tsconfig.json": `{"compilerOptions": {"strict": true` });
    expect(await run(String(dir), "child", ["run", "greet"])).toEqual({
      stdout: "",
      stderr: withLine(`Script not found "greet"`),
      exitCode: 1,
    });
  });

  test.each([
    // The name of the package further up is not the name of this one.
    [["run", "name.js"], { stdout: "undefined", stderr: error, exitCode: 0 }],
    // The scripts that a shell completes.
    [["getcompletes", "s"], { stdout: "", stderr: "", exitCode: 0 }],
  ])("what is of the package further up is not of this one: bun %j", async (args, expected) => {
    using dir = project({ "package.json": text, "name.js": `console.log(process.env.npm_package_name);` });
    expect(await run(String(dir), "child", args)).toEqual(expected);
  });

  // A file that starts with `#!` is no executable on Windows.
  test.skipIf(isWindows)("the directory of the package further up is not in PATH", async () => {
    using dir = project({ "package.json": text });
    writeFileSync(join(String(dir), "beside"), "#!/bin/sh\necho from-parent\n", { mode: 0o755 });
    expect(await run(String(dir), "child", ["run", "beside"])).toEqual({
      stdout: "",
      stderr: withLine(`Script not found "beside"`),
      exitCode: 1,
    });
  });

  // https://github.com/oven-sh/bun/issues/19604
  test.each([
    [["run"], ""],
    [["run", "dev"], `\nerror: Script not found "dev"`],
  ])("a missing comma between two dependencies: bun %j", async (args, line) => {
    using dir = tempDir("run-unparsable-package-json-19604", {
      "package.json": `{\n  "name": "bun-bug",\n  "module": "index.ts",\n  "type": "module",\n  "private": true,\n  "devDependencies": {\n    "@types/bun": "latest"\n    "prettier":"latest"\n  },\n  "peerDependencies": {\n    "typescript": "^5"\n  }\n}\n`,
    });
    expect(await run(String(dir), ".", args)).toEqual({
      stdout: "",
      stderr: `8 |     "prettier":"latest"\n        ^\nerror: Expected "," but found ""prettier""\n    at <dir>/package.json:8:5${line}`,
      exitCode: 1,
    });
  });

  // What follows is as it was.

  test.each([
    [["x.js"], undefined, { stdout: "ran", stderr: error, exitCode: 0 }],
    [["run", "x.js"], undefined, { stdout: "ran", stderr: error, exitCode: 0 }],
    [["run", "./x.js"], undefined, { stdout: "ran", stderr: error, exitCode: 0 }],
    [["-e", `console.log("ran")`], undefined, { stdout: "ran", stderr: error, exitCode: 0 }],
    [["run", "-"], `console.log("ran");`, { stdout: "ran", stderr: error, exitCode: 0 }],
    [["-"], `console.log("ran");`, { stdout: "ran", stderr: error, exitCode: 0 }],
    // Where no script has its name, a file runs. Here that is not known.
    [["run", "tool"], undefined, { stdout: "from-file", stderr: error, exitCode: 0 }],
    // Such a name is not the name of a script.
    [["run", "./missing.js"], undefined, { stdout: "", stderr: `error: Module not found "./missing.js"`, exitCode: 1 }],
    [["build", "./x.js"], undefined, { stdout: "", stderr: error, exitCode: 1 }],
  ])("a file still runs: bun %j", async (args, stdin, expected) => {
    using dir = project({ "package.json": text, "tool.ts": `console.log("from-file");` });
    expect(await run(String(dir), "child", args, stdin)).toEqual(expected);
  });

  // The process of the file says what is wrong as it exits, as above.
  test.each(["x.js", "./x.js"])("a file still runs: bun run --parallel %s", async file => {
    using dir = project({ "package.json": text });
    const { stdout, stderr, exitCode } = await run(String(dir), "child", ["run", "--parallel", file]);
    expect({ stdout, stderr: timed(stderr), exitCode }).toEqual({
      stdout: `${file} | ran`,
      stderr: `${error.replaceAll(/^/gm, `${file} | `)}\n${file} | Done in <time>`,
      exitCode: 0,
    });
  });

  test("a test still runs", async () => {
    using dir = project({
      "package.json": text,
      "x.test.js": `import { expect, test } from "bun:test";\ntest("ran", () => expect(1).toBe(1));`,
    });
    expect(await run(String(dir), "child", ["test", "./x.test.js"])).toEqual({
      stdout: "bun test <version> (<revision>)",
      stderr: `x.test.js:\n(pass) ran\n${error}\n\n 1 pass\n 0 fail\n 1 expect() calls\nRan 1 test across 1 file.`,
      exitCode: 0,
    });
  });

  // A file that starts with `#!` is no executable on Windows. `bun run` says what is wrong before it runs one.
  test.skipIf(isWindows).each([
    ["run", error],
    ["x", ""],
  ])("an executable that a package installs still runs: bun %s", async (command, stderr) => {
    using dir = project({ "package.json": text, "node_modules/.bin/installed": "#!/bin/sh\necho from-bin\n" });
    chmodSync(join(String(dir), "child/node_modules/.bin/installed"), 0o755);
    expect(await run(String(dir), "child", [command, "installed"])).toEqual({
      stdout: "from-bin",
      stderr,
      exitCode: 0,
    });
  });

  test.each([
    ["child", ["run", "greet"], { stdout: "from-child", stderr: "$ echo from-child", exitCode: 0 }],
    ["child/below", ["run", "greet"], { stdout: "from-child", stderr: "$ echo from-child", exitCode: 0 }],
    ["child", ["run", "nope"], { stdout: "", stderr: `error: Script not found "nope"`, exitCode: 1 }],
    ["child/below", ["run", "nope"], { stdout: "", stderr: `error: Script not found "nope"`, exitCode: 1 }],
  ])("a package.json further up that does not parse is not in the way: in %s, bun %j", async (cwd, args, expected) => {
    using dir = tempDir("run-unparsable-package-json-above", {
      "package.json": text,
      "child/package.json": packageJson("child"),
      "child/below/.keep": "",
    });
    expect(await run(String(dir), cwd, args)).toEqual(expected);
  });

  const notFound = { stdout: "", stderr: `error: Script not found "dev"`, exitCode: 1 };
  test.each([
    ["tsconfig.json", "none", ["run", "dev"], notFound],
    ["tsconfig.json", "none", ["dev"], notFound],
    ["tsconfig.json", "none/below", ["run", "dev"], notFound],
    ["jsconfig.json", "none", ["run", "dev"], notFound],
    ["tsconfig.json", "some", ["run", "dev"], notFound],
    ["tsconfig.json", "some", ["run", "greet"], { stdout: "from-some", stderr: "$ echo from-some", exitCode: 0 }],
  ])("a %s that does not parse is not a package.json: in %s, bun %j", async (config, cwd, args, expected) => {
    using dir = tempDir("run-unparsable-config", {
      [`none/${config}`]: `{"compilerOptions": {"strict": true`,
      "none/below/.keep": "",
      [`some/${config}`]: `{"compilerOptions": {"strict": true`,
      "some/package.json": packageJson("some"),
    });
    expect(await run(String(dir), cwd, args)).toEqual(expected);
  });

  // With no package.json in `child`, the nearest one is that of the package further up.
  const parent = { stdout: "from-parent", stderr: "$ echo from-parent", exitCode: 0 };

  test("a package.json that is a directory is no package.json", async () => {
    using dir = project({});
    mkdirSync(join(String(dir), "child/package.json"));
    expect(await run(String(dir), "child", ["run", "greet"])).toEqual(parent);
  });

  test.each([
    ["to nothing", "nowhere.json"],
    ["to itself", "package.json"],
    ["through a file", join("x.js", "package.json")],
  ])("a package.json that is a link %s is no package.json", async (_, target) => {
    using dir = project({});
    symlinkSync(target, join(String(dir), "child/package.json"), "file");
    expect(await run(String(dir), "child", ["run", "greet"])).toEqual(parent);
  });

  // The superuser can read every file, and so can its owner on Windows.
  test.skipIf(isWindows || process.getuid?.() === 0)(
    "a package.json that cannot be read is no package.json",
    async () => {
      using dir = project({ "package.json": packageJson("child") });
      chmodSync(join(String(dir), "child/package.json"), 0o000);
      expect(await run(String(dir), "child", ["run", "greet"])).toEqual(parent);
    },
  );

  test("an empty package.json has no scripts", async () => {
    using dir = project({ "package.json": "" });
    expect(await run(String(dir), "child", ["run", "greet"])).toEqual({
      stdout: "",
      stderr: `error: Script not found "greet"`,
      exitCode: 1,
    });
  });
});

test.if(isWindows)("[windows] A file in drive root runs", async () => {
  const path = "C:\\root-file" + Math.random().toString().slice(2) + ".js";
  try {
    writeFileSync(path, "console.log(`PASS`);");
    const { stdout } = await bunRun("C:\\root-file.js", {});
    expect(stdout).toBe("PASS");
  } catch {
    rmSync(path);
  }
});

// Ctrl+C on a terminal reaches `bun run` and the script together (same pgroup /
// same console). `bun run` must leave it to the script and report its exit; on
// Windows it used to die first with STATUS_CONTROL_C_EXIT. The script raises the
// Ctrl+C itself once it is listening: on POSIX it signals its own foreground
// process group, which is what the line discipline does for ^C; on Windows it
// calls GenerateConsoleCtrlEvent on its own (pseudo)console.
//
// CI agents start the test runner in a new process group, which on Windows means
// "Ctrl+C ignored" - an attribute every descendant inherits (it is also why a
// "\x03" written to a ConPTY looks like it does nothing there). Restore normal
// Ctrl+C processing in this process so the `bun run` we spawn, and its script,
// can receive CTRL_C_EVENT at all.
if (isWindows) {
  const ok = dlopen("kernel32.dll", {
    SetConsoleCtrlHandler: { args: ["ptr", "i32"], returns: "i32" },
  }).symbols.SetConsoleCtrlHandler(null, 0);
  if (!ok) throw new Error("SetConsoleCtrlHandler(NULL, FALSE) failed; the Ctrl+C tests below cannot run");
}

const raiseCtrlC = `
  globalThis.raiseCtrlC = () => {
    if (process.platform === "win32") {
      const { dlopen } = require("bun:ffi");
      const k32 = dlopen("kernel32.dll", { GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" } });
      if (k32.symbols.GenerateConsoleCtrlEvent(0, 0) === 0) throw new Error("GenerateConsoleCtrlEvent failed");
    } else {
      process.kill(0, "SIGINT");
    }
  };
`;

async function runInTerminal(cmd: string[], cwd: string) {
  let output = "";
  const decoder = new TextDecoder();
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: bunEnv,
    // Own session / pseudoconsole, so the Ctrl+C stays between `bun run` and the script.
    terminal: {
      cols: 200,
      rows: 24,
      data(_t, chunk: Uint8Array) {
        output += decoder.decode(chunk, { stream: true });
      },
    },
  });
  const exitCode = await proc.exited;
  proc.terminal?.close();
  output += decoder.decode();
  return { text: Bun.stripANSI(output), exitCode, signalCode: proc.signalCode };
}

// `bun run <script>` with each shell, and `bun run <bin>` (POSIX only: a Windows
// .bin entry is a .cmd, i.e. cmd.exe's batch-mode "Terminate batch job (Y/N)?").
const ctrlCModes = [
  { name: "--shell=bun", args: ["--shell=bun", "go"] },
  { name: "--shell=system", args: ["--shell=system", "go"] },
  ...(isWindows ? [] : [{ name: "<bin>", args: ["childbin"] }]),
];
for (const mode of ctrlCModes) {
  test.concurrent(`Ctrl+C is left to the script and bun run reports its exit (${mode.name})`, async () => {
    using dir = tempDir("run-ctrl-c", {
      "package.json": JSON.stringify({ name: "t", scripts: { go: "bun child.js" } }),
      "node_modules/.bin/childbin": '#!/bin/sh\nexec bun "$(dirname "$0")/../../child.js"\n',
      "child.js": `${raiseCtrlC}
        process.on("SIGINT", () => {
          console.log("child got SIGINT");
          process.exit(42);
        });
        setInterval(() => {}, 1000);
        raiseCtrlC();
      `,
    });
    chmodSync(join(String(dir), "node_modules/.bin/childbin"), 0o755);

    const { text, exitCode } = await runInTerminal([bunExe(), "run", ...mode.args], String(dir));
    expect(text).toContain("child got SIGINT");
    expect(exitCode).toBe(42);
  });

  // ...and if the script *dies* of the Ctrl+C, `bun run` waits for it, stops there
  // (the next command doesn't run) and ends the same way - bash's
  // wait-and-cooperative-exit. The child does its cleanup on the first Ctrl+C and
  // dies of the second; `bun run` must still be around for both.
  test.concurrent(`a script killed by Ctrl+C stops bun run (${mode.name})`, async () => {
    using dir = tempDir("run-ctrl-c-dies", {
      "package.json": JSON.stringify({
        name: "t",
        scripts: {
          // cmd.exe sequences with `&`; sh and the bun shell with `;`.
          go: `bun child.js ${isWindows && mode.name === "--shell=system" ? "&" : ";"} bun -e "console.log(String.fromCharCode(78,79,80,69))"`,
        },
      }),
      "node_modules/.bin/childbin":
        '#!/bin/sh\nbun "$(dirname "$0")/../../child.js"; bun -e "console.log(String.fromCharCode(78,79,80,69))"\n',
      "child.js": `${raiseCtrlC}
        const { writeFileSync } = require("fs");
        process.on("SIGINT", function first() {
          process.removeListener("SIGINT", first);
          writeFileSync("cleanup-done", "");
          console.log("child cleanup done");
          raiseCtrlC();
        });
        setInterval(() => {}, 1000);
        console.log("ready");
        raiseCtrlC();
      `,
    });
    chmodSync(join(String(dir), "node_modules/.bin/childbin"), 0o755);

    const { text, exitCode, signalCode } = await runInTerminal([bunExe(), "run", ...mode.args], String(dir));
    expect(text).toContain("ready");
    // `bun run` outlived the child's cleanup...
    expect(existsSync(join(String(dir), "cleanup-done"))).toBe(true);
    // ...did not go on to the next command...
    expect(text).not.toContain("NOPE");
    // ...and ended like the child did.
    if (isWindows) {
      // STATUS_CONTROL_C_EXIT (0xC000013A); Bun.spawn reports the low byte on Windows.
      expect(exitCode).toBe(0x3a);
    } else {
      expect(signalCode).toBe("SIGINT");
    }
  });
}

describe.concurrent.each([
  ["ESC [ 2 K", "\x1b[2K", "\\x1b[2K"],
  ["CR", "\r", "\\r"],
  ["BEL", "\x07", "\\x07"],
  ["U+009B", "\u009b2K", "\\u009b2K"],
  ["OSC 52", "\x1b]52;c;aGk=\x07", "\\x1b]52;c;aGk=\\x07"],
  ["U+2028", " ", "\\u2028"],
  ["U+202E", "‮", "\\u202e"],
  ["U+2066", "⁦", "\\u2066"],
])("%s in a script of package.json is printed spelled out", (_, raw, spelled) => {
  async function run(...args: string[]) {
    using dir = tempDir("run-script-text", {
      "package.json": JSON.stringify({ name: "run-script-text", scripts: { [`a${raw}b`]: `echo 'c${raw}d'` } }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("in the list of `bun run`", async () => {
    const { stdout, stderr, exitCode } = await run();
    expect(stdout).toEndWith(
      `\npackage.json scripts (1 found):\n  $ bun run a${spelled}b\n    echo 'c${spelled}d'\n\n`,
    );
    expect(stdout + stderr).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
    expect(exitCode).toBe(0);
  });

  test("in the line that says what runs", async () => {
    const { stdout, stderr, exitCode } = await run(`a${raw}b`);
    expect(stderr).toBe(`$ echo 'c${spelled}d'\n`);
    expect(stdout).toBe(`c${raw}d\n`);
    expect(exitCode).toBe(0);
  });
});
