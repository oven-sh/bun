import { spawnSync } from "bun";
import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, tempDir } from "harness";
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

test.if(isWindows).each([[[]], [["run"]]])(
  "[windows] reports a missing absolute script path longer than 1024 bytes as not found: bun %j",
  async args => {
    const missing = "C:\\" + Buffer.alloc(1100, "a").toString() + ".js";
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args, missing],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("Module not found");
    expect(exitCode).toBe(1);
  },
);

// Ctrl+C on a terminal reaches `bun run` and the script together (same pgroup /
// same console). `bun run` must leave it to the script and report its exit; on
// Windows it used to die first with STATUS_CONTROL_C_EXIT.
//
// On POSIX the test types the Ctrl+C: it writes 0x03 to the pty once the script
// has printed a marker, and the line discipline signals the foreground process
// group. On Windows the script raises it itself once it is listening, with
// GenerateConsoleCtrlEvent on its own (pseudo)console.
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

// Windows only. On POSIX the test types the key.
const raiseCtrlC = `
  globalThis.raiseCtrlC = () => {
    if (process.platform !== "win32") return;
    const { dlopen } = require("bun:ffi");
    const k32 = dlopen("kernel32.dll", { GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" } });
    if (k32.symbols.GenerateConsoleCtrlEvent(0, 0) === 0) throw new Error("GenerateConsoleCtrlEvent failed");
  };
`;

/** `cmd` in its own session / pseudoconsole, so the Ctrl+C stays between `bun run` and the script. */
function openTerminal(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  let output = "";
  const decoder = new TextDecoder();
  let wake = Promise.withResolvers<void>();
  const proc = Bun.spawn({
    cmd,
    cwd,
    env,
    terminal: {
      cols: 200,
      rows: 24,
      data(_t, chunk: Uint8Array) {
        output += decoder.decode(chunk, { stream: true });
        wake.resolve();
        wake = Promise.withResolvers<void>();
      },
    },
  });
  const exited = proc.exited.then(() => "exited" as const);
  return {
    pid: proc.pid,
    /** "\x03" is Ctrl+C and "\x1c" is Ctrl+\ on POSIX. */
    type: (keys: string) => void proc.terminal!.write(keys),
    /** Waits until the terminal shows `text`. */
    async printed(text: string) {
      while (!output.includes(text)) {
        if ((await Promise.race([wake.promise, exited])) === "exited" && !output.includes(text))
          throw new Error(`exited before it printed ${JSON.stringify(text)}: ${JSON.stringify(output)}`);
      }
    },
    /** Linux. Waits until the main thread of the command is stopped ("T") or asleep in a wait ("S"). */
    async state(state: "T" | "S") {
      for (;;) {
        const stat = readFileSync(`/proc/${proc.pid}/stat`, "latin1");
        if (stat[stat.lastIndexOf(")") + 2] === state) return;
        await Bun.sleep(1);
      }
    },
    async end() {
      const exitCode = await proc.exited;
      proc.terminal?.close();
      output += decoder.decode();
      return { text: Bun.stripANSI(output), exitCode, signalCode: proc.signalCode };
    },
    [Symbol.asyncDispose]: () => proc[Symbol.asyncDispose](),
  };
}

/** On POSIX, types Ctrl+C each time the next of `typeCtrlCAfter` shows in the output. */
async function runInTerminal(cmd: string[], cwd: string, typeCtrlCAfter: string[]) {
  await using terminal = openTerminal(cmd, cwd);
  if (!isWindows) {
    for (const marker of typeCtrlCAfter) {
      await terminal.printed(marker);
      terminal.type("\x03");
    }
  }
  return await terminal.end();
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
        console.log("ready");
        raiseCtrlC();
      `,
    });
    chmodSync(join(String(dir), "node_modules/.bin/childbin"), 0o755);

    const { text, exitCode } = await runInTerminal([bunExe(), "run", ...mode.args], String(dir), ["ready"]);
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

    const { text, exitCode, signalCode } = await runInTerminal([bunExe(), "run", ...mode.args], String(dir), [
      "ready",
      "child cleanup done",
    ]);
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

// A signal that arrives before `bun run` knows the script's pid is forwarded once the spawn returns.
// `bun run` blocks every signal during the spawn, which is visible in /proc/<pid>/status.
test.skipIf(!isLinux)(
  "forwards a signal that arrives while bun run is spawning the script",
  async () => {
    using dir = tempDir("run-signal-in-spawn", {
      "package.json": JSON.stringify({ name: "t", scripts: { go: "kill -INT $$" } }),
    });

    async function run() {
      // Stops the polling loops if `bun run` never reaches the spawn.
      const deadline = performance.now() + 10_000;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--shell=system", "go"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      const look = () => {
        const status = readFileSync(`/proc/${proc.pid}/status`, "latin1");
        // A signal set is 16 hex digits. SIGINT (2) is in the last digit.
        const sigint = (set: string) => (parseInt(status[status.indexOf(set) + set.length + 15], 16) & 2) !== 0;
        return {
          state: status[status.indexOf("State:\t") + 7],
          // SIGINT is blocked, and the handler that forwards it is installed.
          inSpawn: sigint("SigBlk:\t") && sigint("SigCgt:\t"),
        };
      };
      let inSpawn = false;
      try {
        let now = look();
        while (!now.inSpawn && now.state !== "Z" && performance.now() < deadline) now = look();
        if (now.inSpawn) {
          proc.kill("SIGSTOP");
          while (now.state !== "T" && now.state !== "Z" && performance.now() < deadline) now = look();
          inSpawn = now.state === "T" && now.inSpawn;
          if (inSpawn) proc.kill("SIGINT");
          proc.kill("SIGCONT");
        }
      } catch (e: any) {
        // `bun run` already exited.
        if (e.code !== "ENOENT" && e.code !== "ESRCH") throw e;
      }
      const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { inSpawn, stderr, signalCode: proc.signalCode };
    }

    // A run that wasn't stopped during the spawn proves nothing, so retry.
    let stoppedInSpawn = false;
    for (let attempt = 0; attempt < 20 && !stoppedInSpawn; attempt++) {
      const { inSpawn, ...end } = await run();
      expect(end).toEqual({ stderr: "$ kill -INT $$\n", signalCode: "SIGINT" });
      stoppedInSpawn = inSpawn;
    }
    expect(stoppedInSpawn).toBe(true);
  },
  // 20 runs of a debug build need more than the default 5 seconds.
  30_000,
);

// One key at the terminal is one signal for the script. The terminal sends it to the whole
// foreground process group, so a runner must not send a copy of its own on to a script that is
// in that group. A signal that a process sends to the runner alone is still sent on.
//
// Linux only: there the kernel marks a terminal's signal (si_code SI_KERNEL). macOS does not, so
// bun still sends every signal on there. /proc also shows when the runner is stopped ("T") and
// when it has handled its signals and waits again ("S").
describe.skipIf(!isLinux)("one key at the terminal is one signal for the script", () => {
  for (const [signal, key] of [
    ["SIGINT", "\x03"],
    ["SIGQUIT", "\x1c"],
  ] as const) {
    for (const mode of [
      { name: "--shell=system", args: ["--shell=system", "go"] },
      { name: "<bin>", args: ["childbin"] },
    ]) {
      test(`${signal}: bun run ${mode.name} sends on a kill(2), not the key`, async () => {
        using dir = tempDir("run-key-once", {
          "package.json": JSON.stringify({ name: "t", scripts: { go: "bun child.js" } }),
          "node_modules/.bin/childbin": '#!/bin/sh\nexec bun "$(dirname "$0")/../../child.js"\n',
          "child.js": `
            let signals = 0;
            process.on("${signal}", () => console.log("${signal} " + ++signals));
            let lines = 0;
            process.stdin.on("data", () => {
              if (++lines === 2) process.exit(0);
              console.log("still here");
            });
            console.log("ready");
          `,
        });
        chmodSync(join(String(dir), "node_modules/.bin/childbin"), 0o755);

        await using terminal = openTerminal([bunExe(), "run", ...mode.args], String(dir));
        await terminal.printed("ready");
        // For `bun run` alone: the script gets it from `bun run`.
        process.kill(terminal.pid, signal);
        await terminal.printed(`${signal} 1`);
        // `bun run` is stopped while the key is typed. The script takes the key first, so a
        // copy from `bun run` could not merge with it.
        process.kill(terminal.pid, "SIGSTOP");
        await terminal.state("T");
        terminal.type(key);
        await terminal.printed(`${signal} 2`);
        process.kill(terminal.pid, "SIGCONT");
        await terminal.state("S");
        // Two lines to the script and back: it would have printed a copy by now.
        terminal.type("\n");
        await terminal.printed("still here");
        terminal.type("\n");
        const { text, exitCode } = await terminal.end();
        expect(text).not.toContain(`${signal} 3`);
        expect(exitCode).toBe(0);
      });
    }
  }

  // The key can come while `bun run` is inside the spawn of the script. It blocks every signal
  // there, which /proc/<pid>/status shows, and it must know the pid when it unblocks them: the
  // script exists and has the key.
  test("SIGINT: bun run does not send the key on when it comes during the spawn of the script", async () => {
    using dir = tempDir("run-key-in-spawn", {
      "node_modules/.bin/childbin": '#!/bin/sh\nexec bun "$(dirname "$0")/../../child.js"\n',
      "child.js": `
          let signals = 0;
          process.on("SIGINT", () => console.log("SIGINT " + ++signals));
          let lines = 0;
          process.stdin.on("data", () => {
            if (++lines === 2) process.exit(0);
            console.log("still here");
          });
          console.log("ready");
        `,
    });
    chmodSync(join(String(dir), "node_modules/.bin/childbin"), 0o755);

    async function run() {
      await using terminal = openTerminal([bunExe(), "run", "childbin"], String(dir));
      const look = () => {
        const status = readFileSync(`/proc/${terminal.pid}/status`, "latin1");
        // A signal set is 16 hex digits. SIGINT (2) and SIGQUIT (3) are in the last digit.
        const last = (set: string) => parseInt(status[status.indexOf(set) + set.length + 15], 16);
        return {
          state: status[status.indexOf("State:\t") + 7],
          // The handler that sends signals on is installed: nothing else in `bun run` catches SIGQUIT.
          sendsOn: (last("SigCgt:\t") & 4) !== 0,
          blocked: (last("SigBlk:\t") & 2) !== 0,
        };
      };
      // Stops the polling if `bun run` never gets to the spawn.
      const deadline = performance.now() + 10_000;
      let now = look();
      // Until `bun run` is inside the spawn, or past it and asleep in its wait for the script.
      while (!(now.sendsOn && (now.blocked || now.state === "S")) && performance.now() < deadline) now = look();
      process.kill(terminal.pid, "SIGSTOP");
      while (now.state !== "T" && performance.now() < deadline) now = look();
      const inSpawn = now.state === "T" && now.sendsOn && now.blocked;
      await terminal.printed("ready");
      if (inSpawn) {
        terminal.type("\x03");
        await terminal.printed("SIGINT 1");
      }
      process.kill(terminal.pid, "SIGCONT");
      await terminal.state("S");
      terminal.type("\n");
      await terminal.printed("still here");
      terminal.type("\n");
      return { inSpawn, ...(await terminal.end()) };
    }

    // A run that was not stopped inside the spawn proves nothing, so try again.
    let stoppedInSpawn = false;
    for (let attempt = 0; attempt < 20 && !stoppedInSpawn; attempt++) {
      const { inSpawn, text, exitCode } = await run();
      expect(text).not.toContain("SIGINT 2");
      expect(exitCode).toBe(0);
      stoppedInSpawn = inSpawn;
    }
    expect(stoppedInSpawn).toBe(true);
  }, 30_000); // 20 runs of a debug build need more than the default 5 seconds.

  // The first SIGINT starts a shutdown that the test ends with a file. A second one forces the exit.
  const graceful = (onFirstSigint: string) => `
    const { existsSync, writeFileSync } = require("fs");
    let sigints = 0;
    process.on("SIGINT", () => {
      if (++sigints > 1) {
        console.log("second SIGINT: forced exit");
        process.exit(130);
      }
      ${onFirstSigint};
      setInterval(() => {
        if (existsSync(process.env.GO_FILE)) {
          console.log("shutdown finished");
          process.exit(0);
        }
      }, 5);
    });
    setInterval(() => {}, 1000);
    console.log("graceful ready");
  `;

  for (const mode of [
    { name: "--filter", args: ["--filter", "a", "graceful"] },
    { name: "--parallel", args: ["--parallel", "graceful"] },
    { name: "of a script that is bun run --filter", args: ["nested"] },
  ]) {
    test(`Ctrl+C: bun run ${mode.name} leaves the script its graceful shutdown`, async () => {
      using dir = tempDir("run-key-once-multi", {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          scripts: { graceful: "bun graceful.js", nested: `${bunExe()} run --filter a graceful` },
        }),
        "packages/a/package.json": JSON.stringify({ name: "a", scripts: { graceful: "bun ../../graceful.js" } }),
        "graceful.js": graceful(`console.log("shutdown started")`),
      });
      const goFile = join(String(dir), "go");
      await using terminal = openTerminal([bunExe(), "run", ...mode.args], String(dir), {
        ...bunEnv,
        GO_FILE: goFile,
      });
      await terminal.printed("graceful ready");
      terminal.type("\x03");
      await terminal.printed("shutdown started");
      // The runner has shown that line, and then it acts on the Ctrl+C: wait for that.
      await terminal.state("S");
      writeFileSync(goFile, "");
      const { text, exitCode } = await terminal.end();
      expect(text).toContain("shutdown finished");
      expect(text).not.toContain("forced exit");
      expect(exitCode).toBe(0);
    });
  }

  test("Ctrl+C: the failure of one --parallel script does not signal the other again", async () => {
    using dir = tempDir("run-key-once-cascade", {
      "package.json": JSON.stringify({ name: "t", scripts: { fails: "bun fails.js", graceful: "bun graceful.js" } }),
      // Both scripts take the Ctrl+C without a word, so that the exit of this one is what wakes the runner.
      "fails.js": `
        const { existsSync } = require("fs");
        process.on("SIGINT", () => {});
        setInterval(() => {
          if (existsSync(process.env.FAIL_FILE)) process.exit(1);
        }, 5);
        console.log("fails ready");
      `,
      "graceful.js": graceful(`writeFileSync(process.env.STARTED_FILE, "")`),
    });
    const file = (name: string) => join(String(dir), name);
    await using terminal = openTerminal([bunExe(), "run", "--parallel", "fails", "graceful"], String(dir), {
      ...bunEnv,
      FAIL_FILE: file("fail"),
      STARTED_FILE: file("started"),
      GO_FILE: file("go"),
    });
    await terminal.printed("fails ready");
    await terminal.printed("graceful ready");
    terminal.type("\x03");
    while (!existsSync(file("started"))) await Bun.sleep(1);
    writeFileSync(file("fail"), "");
    await terminal.printed("Exited with code 1");
    await terminal.state("S");
    writeFileSync(file("go"), "");
    const { text, exitCode } = await terminal.end();
    expect(text).toContain("shutdown finished");
    expect(text).not.toContain("forced exit");
    expect(exitCode).toBe(1);
  });

  // No terminal sent the Ctrl+C to a script that was not running yet.
  test("Ctrl+C: a script that starts after it gets the SIGINT from the runner", async () => {
    const idle = (name: string) => `
      setInterval(() => {}, 1000);
      console.log("${name} ready");
    `;
    using dir = tempDir("run-key-once-late", {
      "package.json": JSON.stringify({ name: "t", scripts: { first: "bun first.js", second: "bun second.js" } }),
      "first.js": idle("first"),
      "second.js": idle("second"),
    });
    await using terminal = openTerminal(
      [bunExe(), "run", "--sequential", "--no-exit-on-error", "first", "second"],
      String(dir),
    );
    await terminal.printed("first ready");
    terminal.type("\x03");
    const { exitCode } = await terminal.end();
    expect(exitCode).toBe(130);
  });

  for (const mode of [
    { name: "--filter", args: ["--filter", "a", "chatty"] },
    { name: "--parallel", args: ["--parallel", "chatty"] },
  ]) {
    test(`a SIGINT for bun run ${mode.name} alone reaches the script`, async () => {
      using dir = tempDir("run-sigint-multi", {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          scripts: { chatty: "bun chatty.js" },
        }),
        "packages/a/package.json": JSON.stringify({ name: "a", scripts: { chatty: "bun ../../chatty.js" } }),
        // The runner looks at a SIGINT when a script prints or exits.
        "chatty.js": `
          process.on("SIGINT", () => {
            console.log("script got SIGINT");
            process.exit(0);
          });
          setInterval(() => console.log("tick"), 5);
        `,
      });
      await using terminal = openTerminal([bunExe(), "run", ...mode.args], String(dir));
      await terminal.printed("tick");
      process.kill(terminal.pid, "SIGINT");
      const { text, exitCode } = await terminal.end();
      expect(text).toContain("script got SIGINT");
      expect(exitCode).toBe(0);
    });
  }
});

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

  test("in the line that prints the command", async () => {
    const { stdout, stderr, exitCode } = await run(`a${raw}b`);
    expect(stderr).toBe(`$ echo 'c${spelled}d'\n`);
    expect(stdout).toBe(`c${raw}d\n`);
    expect(exitCode).toBe(0);
  });
});
