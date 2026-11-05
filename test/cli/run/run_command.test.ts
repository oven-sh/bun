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
