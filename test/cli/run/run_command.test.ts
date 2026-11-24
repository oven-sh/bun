import { spawnSync } from "bun";
import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import { delimiter, dirname, join } from "path";

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

  test("$PATH has node_modules/.bin of the cwd and of each parent once", async () => {
    using dir = tempDir("run-path-entries", {
      "package.json": JSON.stringify({ scripts: { path: "echo $PATH" } }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--silent", "--shell=bun", "path"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const expected: string[] = [];
    for (let parent = String(dir); ; parent = dirname(parent)) {
      expected.push(join(parent, "node_modules", ".bin"));
      if (parent === dirname(parent)) break;
    }
    const bins = stdout.split(delimiter).filter(entry => entry.endsWith(".bin"));
    expect(bins.slice(0, expected.length)).toEqual(expected);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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

// POSIX: `execve` answers ENOEXEC for a text file that has no `#!` line, and a shell then runs the file with sh.
// npm runs a command through a shell, and pnpm 12.21.0 ships such a bin. Windows has no ENOEXEC and no /bin/sh.
describe.concurrent.skipIf(isWindows)("a command that is a script with no #! line", () => {
  // 127 bytes with no NUL and no newline. The next byte is byte 128 of the file: the last one that the check reads.
  const line127 = "echo ok #" + Buffer.alloc(127 - 9, "x").toString();

  function project(bin: string | ((at: { root: string }) => string), mode = 0o755) {
    const dir = tempDir("run-no-shebang", {
      "package.json": `{ "name": "app", "scripts": { "from-script": "tool from-script" } }`,
      "node_modules/.bin/tool": bin,
      "node_modules/.bin/sibling": `#!/bin/sh\nprintf '[sibling of %s]' "$1"\n`,
      empty: "",
    });
    const tool = join(String(dir), "node_modules", ".bin", "tool");
    chmodSync(tool, mode);
    chmodSync(join(String(dir), "node_modules", ".bin", "sibling"), 0o755);
    chmodSync(join(String(dir), "empty"), 0o755);
    return { cwd: String(dir), tool, [Symbol.dispose]: () => dir[Symbol.dispose]() };
  }

  async function run(
    cmd: string[],
    cwd: string,
    env: Record<string, string | undefined> = bunEnv,
    user: { uid?: number; gid?: number } = {},
  ) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd, env, stdout: "pipe", stderr: "pipe", ...user });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  /** What `bun run tool` prints when the spawn of the bin fails. */
  const failedToRun = (code: string, message: string) => ({
    stdout: "",
    stderr: `error: Failed to run "tool" due to:\n${code}: <tool>: ${message} (posix_spawn())\n`,
    exitCode: 1,
  });
  const enoexec = failedToRun("ENOEXEC", "Exec format error");

  async function runTool(app: { cwd: string; tool: string }, user?: { uid?: number; gid?: number }) {
    const { stdout, stderr, exitCode } = await run(["run", "tool"], app.cwd, bunEnv, user);
    return { stdout, stderr: stderr.replaceAll(app.tool, "<tool>"), exitCode };
  }

  test.each([[["run", "tool"]], [["tool"]], [["run", "--silent", "tool"]], [["x", "tool"]]])(
    "bun %j runs it with sh",
    async cmd => {
      // `sibling` is on the `PATH` that Bun makes for the bin, and not on the one of the test.
      using app = project(`printf '[%s]' "$0" "$#" "$@" "$PWD" "$FROM_TEST"\nsibling "$npm_package_name"\n`);
      // The script gets each argument as one word: nothing expands `$HOME` or `*`, and sh takes none for an option.
      const args = ["a b", "$HOME", "*", "-c", "", "--", "-x"];
      expect(await run([...cmd, ...args], app.cwd, { ...bunEnv, FROM_TEST: "env" })).toEqual({
        stdout: `[${app.tool}][7][a b][$HOME][*][-c][][--][-x][${app.cwd}][env][sibling of app]`,
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test("a script on $PATH that is not in node_modules/.bin runs too", async () => {
    using dir = tempDir("run-no-shebang-path", { "package.json": `{ "name": "app" }`, "bin/tool": "echo on-path\n" });
    chmodSync(join(String(dir), "bin", "tool"), 0o755);
    const env = { ...bunEnv, PATH: join(String(dir), "bin") + delimiter + bunEnv.PATH };
    expect(await run(["run", "tool"], String(dir), env)).toEqual({ stdout: "on-path\n", stderr: "", exitCode: 0 });
  });

  // `bun install` sets BUN_WHICH_IGNORE_CWD for a lifecycle script. bunx then finds the bin by a relative path.
  test("bunx runs a script that it finds through a relative entry of $PATH", async () => {
    using dir = tempDir("run-no-shebang-relative", {
      "package.json": `{ "name": "app" }`,
      "relbin/tool": `printf '[%s]' "$0" "$@"\n`,
    });
    const tool = join(String(dir), "relbin", "tool");
    chmodSync(tool, 0o755);
    const env = { ...bunEnv, PATH: "relbin" + delimiter + bunEnv.PATH, BUN_WHICH_IGNORE_CWD: join(String(dir), "x") };
    expect(await run(["x", "tool", "a"], String(dir), env)).toEqual({
      stdout: `[${tool}][a]`,
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    ["bun run --shell=bun <script>", ["run", "--silent", "--shell=bun", "from-script"], "from-script"],
    ["bun exec", ["exec", "./node_modules/.bin/tool from-exec"], "from-exec"],
  ])("Bun Shell runs it with sh: %s", async (_, cmd, arg) => {
    using app = project(`printf '[%s]' "$0" "$@"\n`);
    expect(await run(cmd, app.cwd)).toEqual({ stdout: `[${app.tool}][${arg}]`, stderr: "", exitCode: 0 });
  });

  test.each([
    ["exits 7", "exit 7\n", "", 7],
    ["starts with a comment and a blank line", "# a tool\n\necho after\n", "after\n", 0],
    // sh runs a file that has no command, and exits 0.
    ["is one newline", "\n", "", 0],
    ["is blank lines and a comment", " \n\t# placeholder\n", "", 0],
    ["has a NUL after its first line", "echo one\nexit\n\0\0\0", "one\n", 0],
    ["has a NUL in byte 129 of its first line", line127 + "x\0\n", "ok\n", 0],
    ["starts with 128 bytes of comment", "#" + Buffer.alloc(126, "x").toString() + "\necho after\n", "after\n", 0],
  ])("a bin that %s runs", async (_, bin, stdout, exitCode) => {
    using app = project(bin);
    expect(await run(["run", "--silent", "tool"], app.cwd)).toEqual({ stdout, stderr: "", exitCode });
  });

  // `bun install` links a bin as a symlink. A `.sh` file runs in sh and not in Bun Shell, which has no functions.
  test("a bin that is a symlink to a file with a .sh name runs", async () => {
    using dir = tempDir("run-no-shebang-sh", {
      "package.json": `{ "name": "app" }`,
      "node_modules/pkg/tool.sh": "f() { echo in-a-function; }\nf\n",
    });
    chmodSync(join(String(dir), "node_modules", "pkg", "tool.sh"), 0o755);
    mkdirSync(join(String(dir), "node_modules", ".bin"));
    symlinkSync("../pkg/tool.sh", join(String(dir), "node_modules", ".bin", "tool"));
    expect(await run(["run", "tool"], String(dir))).toEqual({ stdout: "in-a-function\n", stderr: "", exitCode: 0 });
  });

  // sh cannot tell prose from a script. Such a bin is a placeholder that a postinstall did not replace.
  test("a bin that is prose fails in sh", async () => {
    using app = project("This file is a placeholder\n");
    const { stdout, stderr, exitCode } = await run(["run", "--silent", "tool"], app.cwd);
    expect(stderr).toContain("not found");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 127 });
  });

  // A shell refuses a file that cannot be a script. An empty file is a placeholder: sh exits 0 for it and prints
  // nothing. A `#!` line names an interpreter that the kernel could not run, and that is not sh.
  test.each([
    ["is empty", ""],
    ["has a NUL in its first line", "echo a\0b\n"],
    ["has a NUL in byte 128 of its first line", line127 + "\0\n"],
    ["is the 4 bytes of the ELF magic", "\x7fELF"],
    ["has a #! line that names an empty file", ({ root }: { root: string }) => `#!${root}/empty\necho ran-by-sh\n`],
  ])("a bin that %s keeps ENOEXEC", async (_, bin) => {
    using app = project(bin);
    expect(await runTool(app)).toEqual(enoexec);
  });

  // sh would run the JavaScript as commands. Bun runs such a bin as a module only on Windows.
  test("a bin whose file has a JavaScript name keeps ENOEXEC", async () => {
    using dir = tempDir("run-no-shebang-js", {
      "package.json": `{ "name": "app" }`,
      "node_modules/pkg/cli.mjs": "echo ran-by-sh\n",
    });
    chmodSync(join(String(dir), "node_modules", "pkg", "cli.mjs"), 0o755);
    mkdirSync(join(String(dir), "node_modules", ".bin"));
    const tool = join(String(dir), "node_modules", ".bin", "tool");
    symlinkSync("../pkg/cli.mjs", tool);
    expect(await runTool({ cwd: String(dir), tool })).toEqual(enoexec);
  });

  // root can read a file of any mode, so Bun does not run as root here.
  test("a bin that cannot be read keeps ENOEXEC", async () => {
    using app = project("echo ran-by-sh\n", 0o111);
    using unprivileged = unprivilegedSpawnOptions(app.cwd);
    expect(await runTool(app, unprivileged)).toEqual(enoexec);
  });

  test("a bin whose #! line names a missing file keeps ENOENT", async () => {
    using app = project(({ root }) => `#!${root}/missing\necho ran-by-sh\n`);
    expect(await runTool(app)).toEqual(failedToRun("ENOENT", "No such file or directory"));
  });

  // Only ENOEXEC reaches sh. Linux answers ETXTBSY for a file that is open for writing. macOS does not, and neither do
  // some Linux kernels.
  const isBusyWhileOpenForWriting =
    isLinux &&
    (() => {
      using app = project("exit\n");
      const fd = openSync(app.tool, "r+");
      try {
        spawnSync({ cmd: [app.tool], env: bunEnv });
        return false;
      } catch (error: any) {
        return error.code === "ETXTBSY";
      } finally {
        closeSync(fd);
      }
    })();

  test.skipIf(!isBusyWhileOpenForWriting)("a bin that is open for writing keeps ETXTBSY", async () => {
    using app = project("echo ran-by-sh\n");
    const fd = openSync(app.tool, "r+");
    try {
      expect(await runTool(app)).toEqual(failedToRun("ETXTBSY", "Text file busy"));
    } finally {
      closeSync(fd);
    }
  });

  // `--no-orphans` puts the bin in a process group of its own. sh is in that group when it runs the bin.
  test.skipIf(!isLinux).each([
    [["run", "--no-orphans", "tool"], true],
    [["run", "tool"], false],
  ])("bun %j: the script leads a process group: %p", async (cmd, leadsGroup) => {
    using app = project("echo $$\nread line\nexit 0\n");
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      cwd: app.cwd,
      env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let pid = "";
    for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
      pid += chunk;
      if (pid.endsWith("\n")) break;
    }
    expect(pid).toMatch(/^[1-9][0-9]*\n$/);
    let groupExists = true;
    try {
      process.kill(-Number(pid), 0);
    } catch (error: any) {
      groupExists = error.code !== "ESRCH";
    }
    proc.stdin.end();
    expect({ groupExists, stderr: await proc.stderr.text(), exitCode: await proc.exited }).toEqual({
      groupExists: leadsGroup,
      stderr: "",
      exitCode: 0,
    });
  });

  // `Bun.spawn` is posix_spawn(3), not a shell: it returns the error of the kernel.
  test("Bun.spawnSync keeps ENOEXEC", () => {
    using app = project("echo hi\n");
    expect(() => spawnSync({ cmd: [app.tool], env: bunEnv })).toThrow(expect.objectContaining({ code: "ENOEXEC" }));
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
