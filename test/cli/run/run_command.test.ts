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

describe.concurrent("did you mean", () => {
  async function run(dir: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("suggests the package.json script a typo is close to", async () => {
    using dir = tempDir("run-did-you-mean", {
      "package.json": JSON.stringify({ scripts: { build: "echo hi", lint: "echo lint" } }),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "run", "buidl");
    expect(stdout).toBe("");
    expect(stderr).toBe('error: Script not found "buidl"\nnote: did you mean "bun run build"?\n');
    expect(exitCode).toBe(1);
  });

  test("ignores case, lists the scripts the name is a prefix of, and stops at three", async () => {
    using dir = tempDir("run-did-you-mean-prefix", {
      "package.json": JSON.stringify({
        scripts: { "build:watch": "echo", "build:server": "echo", "build:client": "echo", build: "echo", test: "echo" },
      }),
    });
    const { stderr, exitCode } = await run(String(dir), "run", "Buil");
    // Closest first, then package.json order: the shorter prefix match before the longer ones.
    expect(stderr).toBe(
      'error: Script not found "Buil"\nnote: did you mean "bun run build", "bun run build:watch" or "bun run build:server"?\n',
    );
    expect(exitCode).toBe(1);

    const dev = await run(String(dir), "run", "dev");
    expect(dev.stderr).toBe('error: Script not found "dev"\n');
    expect(dev.exitCode).toBe(1);
  });

  test("suggests a node_modules/.bin entry, from a subdirectory too", async () => {
    using dir = tempDir("run-did-you-mean-bin", {
      "package.json": JSON.stringify({ scripts: { start: "echo" } }),
      [isWindows ? "node_modules/.bin/eslint.cmd" : "node_modules/.bin/eslint"]: "",
      "src/deep/.keep": "",
    });
    const { stderr, exitCode } = await run(join(String(dir), "src", "deep"), "run", "eslnt");
    expect(stderr).toBe('error: Script not found "eslnt"\nnote: did you mean "bun run eslint"?\n');
    expect(exitCode).toBe(1);
  });

  test("a bare `bun <name>` also gets bun's own commands, `bun run <name>` does not", async () => {
    using dir = tempDir("run-did-you-mean-command", {
      "package.json": JSON.stringify({ scripts: { start: "echo" } }),
    });
    const bare = await run(String(dir), "instal");
    expect(bare.stderr).toBe('error: Script not found "instal"\nnote: did you mean "bun install"?\n');
    expect(bare.exitCode).toBe(1);

    const explicit = await run(String(dir), "run", "instal");
    expect(explicit.stderr).toBe('error: Script not found "instal"\n');
    expect(explicit.exitCode).toBe(1);
  });

  test("a typo of an alias is pointed at the command's name", async () => {
    using dir = tempDir("run-did-you-mean-alias", {
      "package.json": JSON.stringify({ scripts: { start: "echo" } }),
    });
    const { stderr, exitCode } = await run(String(dir), "uninstal");
    expect(stderr).toBe('error: Script not found "uninstal"\nnote: did you mean "bun remove"?\n');
    expect(exitCode).toBe(1);

    // Reserved words (`deploy`) are not commands yet and are not suggested.
    const reserved = await run(String(dir), "depoy");
    expect(reserved.stderr).toBe('error: Script not found "depoy"\n');
    expect(reserved.exitCode).toBe(1);
  });

  test("says nothing when no name is close", async () => {
    using dir = tempDir("run-did-you-mean-none", {
      "package.json": JSON.stringify({ scripts: { build: "echo", test: "echo" } }),
    });
    const { stderr, exitCode } = await run(String(dir), "run", "deploy");
    expect(stderr).toBe('error: Script not found "deploy"\n');
    expect(exitCode).toBe(1);
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
