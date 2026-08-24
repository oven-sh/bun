import { spawnSync } from "bun";
import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isMacOS, isWindows, libcPathForDlopen, tempDir } from "harness";
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

// POSIX signal mask of this thread, through libc. `pthread_sigmask` takes a
// `sigset_t*`; SIGINT is signal 2, bit 1 of the set's first byte on every libc
// we run on. The `how` constants differ: Linux 0/1/2, Darwin 1/2/3.
const SIG_BLOCK = isMacOS ? 1 : 0;
const SIG_UNBLOCK = isMacOS ? 2 : 1;
const SIGINT_SET_BYTE0 = 1 << (2 - 1);
function sigmaskSymbols() {
  return dlopen(libcPathForDlopen(), {
    pthread_sigmask: { args: ["i32", "ptr", "ptr"], returns: "i32" },
  }).symbols;
}
// A child spawned while SIGINT is blocked here starts with SIGINT blocked too.
function withSigintBlocked<T>(f: () => T): T {
  const { pthread_sigmask } = sigmaskSymbols();
  const set = new Uint8Array(128);
  set[0] = SIGINT_SET_BYTE0;
  if (pthread_sigmask(SIG_BLOCK, set, null) !== 0) throw new Error("pthread_sigmask(SIG_BLOCK) failed");
  try {
    return f();
  } finally {
    if (pthread_sigmask(SIG_UNBLOCK, set, null) !== 0) throw new Error("pthread_sigmask(SIG_UNBLOCK) failed");
  }
}

async function runInTerminal(cmd: string[], cwd: string, { blockSigint = false } = {}) {
  let output = "";
  const decoder = new TextDecoder();
  const spawn = () =>
    Bun.spawn({
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
  await using proc = blockSigint ? withSigintBlocked(spawn) : spawn();
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

// `bun run --shell=system` forwards the signals it gets to the script. A signal
// that lands between the install of the forwarding handler and the moment the
// script's pid is known is recorded and forwarded once the pid is known. That
// forward runs on the waiting thread (not in the handler) and used to leave the
// signal blocked there for good, so the final `raise(SIGINT)` that ends `bun run`
// like its script never arrived and `bun run` fell through to `abort()`.
//
// SIGINT is ignored from before exec (`trap '' INT`): a SIGINT before the
// handler is installed is dropped, one during the spawn takes the recorded
// path, one after it is forwarded right away. Flooding SIGINT for the whole
// life of `bun run` therefore exercises the recorded path without a sleep.
// A flood that misses the spawn window makes this test pass, never fail.
test.concurrent.skipIf(isWindows)(
  "a Ctrl+C that lands while bun run spawns the script still ends bun run like the script",
  async () => {
    using dir = tempDir("run-ctrl-c-spawn-window", {
      "package.json": JSON.stringify({ name: "t", scripts: { go: "kill -INT $$" } }),
    });
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", 'trap "" INT; exec "$0" "$@"', bunExe(), "run", "--shell=system", "go"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await using flooder = Bun.spawn({
      cmd: ["sh", "-c", "while kill -INT $1 2>/dev/null; do :; done", "_", String(proc.pid)],
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    flooder.kill();
    await flooder.exited;
    expect(stdout).toBe("");
    expect(stderr).toContain("$ kill -INT $$");
    expect(proc.signalCode).toBe("SIGINT");
  },
);

// The end of `bun run` must not depend on its signal mask either: with SIGINT
// blocked in the mask it inherited, `raise(SIGINT)` alone would stay pending and
// `bun run` would die of SIGABRT. The script unblocks SIGINT for itself, then dies of it.
test.concurrent.skipIf(isWindows)(
  "bun run ends like its script when SIGINT is blocked in the mask it inherited",
  async () => {
    using dir = tempDir("run-ctrl-c-blocked-mask", {
      "package.json": JSON.stringify({ name: "t", scripts: { go: "bun child.js" } }),
      "child.js": `
      const { dlopen } = require("bun:ffi");
      const { pthread_sigmask } = dlopen(${JSON.stringify(libcPathForDlopen())}, {
        pthread_sigmask: { args: ["i32", "ptr", "ptr"], returns: "i32" },
      }).symbols;
      const set = new Uint8Array(128);
      set[0] = ${SIGINT_SET_BYTE0};
      if (pthread_sigmask(${SIG_UNBLOCK}, set, null) !== 0) throw new Error("pthread_sigmask failed");
      process.kill(process.pid, "SIGINT");
      console.log("still alive");
    `,
    });

    const { text, signalCode } = await runInTerminal([bunExe(), "run", "--shell=system", "go"], String(dir), {
      blockSigint: true,
    });
    expect(text).not.toContain("still alive");
    expect(signalCode).toBe("SIGINT");
  },
);
