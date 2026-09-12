import { spawnSync } from "bun";
import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import { join } from "path";

let cwd: string;

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

// https://github.com/oven-sh/bun/issues/13984
describe.concurrent("process.argv passthrough", () => {
  const argvJs = `process.stdout.write(JSON.stringify(process.argv.slice(2)));`;

  async function spawnArgv(cmd: string[], cwd: string) {
    await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.each([
    // [argv after bunExe, expected process.argv.slice(2)]
    [
      ["<file>", "--", "rest"],
      ["--", "rest"],
    ],
    [["<file>", "--"], ["--"]],
    [
      ["<file>", "--", "--", "rest"],
      ["--", "--", "rest"],
    ],
    [
      ["<file>", "foo", "--", "rest"],
      ["foo", "--", "rest"],
    ],
    [
      ["<file>", "--", "--watch"],
      ["--", "--watch"],
    ],
    [
      ["run", "<file>", "--", "rest"],
      ["--", "rest"],
    ],
    [["run", "<file>", "--"], ["--"]],
    [
      ["run", "<file>", "foo", "--", "rest"],
      ["foo", "--", "rest"],
    ],
    [
      ["--", "<file>", "--", "rest"],
      ["--", "rest"],
    ],
  ] as const)("bun %j -> %j", async (args, expected) => {
    using dir = tempDir("argv-passthrough", { "argv.js": argvJs });
    const cmd = [bunExe(), ...args.map(a => (a === "<file>" ? "argv.js" : a))];
    expect(await spawnArgv(cmd, String(dir))).toEqual({
      stdout: JSON.stringify(expected),
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    [
      ["--", "a", "b"],
      ["a", "b"],
    ],
    [
      ["a", "b"],
      ["a", "b"],
    ],
    [
      ["--", "--", "a"],
      ["--", "a"],
    ],
  ] as const)("package.json script: bun run go %j -> %j (npm compat)", async (extra, expected) => {
    using dir = tempDir("argv-script", {
      "argv.js": argvJs,
      "package.json": JSON.stringify({
        scripts: { go: `${JSON.stringify(bunExe())} argv.js` },
      }),
    });
    expect(await spawnArgv([bunExe(), "--silent", "run", "go", ...extra], String(dir))).toEqual({
      stdout: JSON.stringify(expected),
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun-shell script: $N positionals are the stripped passthrough, main script only", async () => {
    using dir = tempDir("argv-shell-positional", {
      "package.json": JSON.stringify({
        scripts: { prego: "echo pre:$1", go: "echo $1.$2", postgo: "echo post:$1" },
      }),
    });
    const { stdout, stderr, exitCode } = await spawnArgv(
      [bunExe(), "--silent", "--shell=bun", "run", "go", "--", "foo", "bar"],
      String(dir),
    );
    expect({ stdout: stdout.replaceAll("\r\n", "\n"), stderr, exitCode }).toEqual({
      stdout: "pre:\nfoo.bar foo bar\npost:\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("--filter appends passthrough to the main script only, not pre/post", async () => {
    using dir = tempDir("argv-filter-lifecycle", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["pkg"] }),
      pkg: {
        "package.json": JSON.stringify({
          name: "pkg",
          scripts: { prego: "echo pre", go: "echo main", postgo: "echo post" },
        }),
      },
    });
    const { stdout, stderr, exitCode } = await spawnArgv(
      [bunExe(), "run", "--filter", "pkg", "go", "--", "x", "y"],
      String(dir),
    );
    expect({ stdout: stdout.replaceAll("\r\n", "\n"), stderr, exitCode }).toEqual({
      stdout: [
        "pkg prego: pre",
        "pkg prego: Exited with code 0",
        "pkg go: main x y",
        "pkg go: Exited with code 0",
        "pkg postgo: post",
        "pkg postgo: Exited with code 0",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  test("node_modules/.bin binary still strips one leading --", async () => {
    const binName = isWindows ? "mybin.cmd" : "mybin";
    const binBody = isWindows
      ? `@"${bunExe()}" "%~dp0\\..\\mybin\\argv.js" %*\r\n`
      : `#!/bin/sh\nexec "${bunExe()}" "$(dirname "$0")/../mybin/argv.js" "$@"\n`;
    using dir = tempDir("argv-bin", {
      "package.json": JSON.stringify({ name: "consumer" }),
      "node_modules": {
        ".bin": { [binName]: binBody },
        "mybin": { "argv.js": argvJs },
      },
    });
    if (!isWindows) {
      chmodSync(join(String(dir), "node_modules", ".bin", binName), 0o755);
    }
    expect(await spawnArgv([bunExe(), "--silent", "run", "mybin", "--", "a", "b"], String(dir))).toEqual({
      stdout: JSON.stringify(["a", "b"]),
      stderr: "",
      exitCode: 0,
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
