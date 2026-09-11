import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, libcPathForDlopen, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { closeSync, constants, existsSync, openSync } from "node:fs";
import { join } from "node:path";

const versionCmd = JSON.stringify([bunExe(), "--version"]);

describe.skipIf(isWindows)("Bun.file() as stdio is opened without blocking the parent", () => {
  // On a regressed bun these spawns block, so they run in a child bun (a timed-out test, not a
  // frozen runner). Afterwards it is killed and each fifo's peer end is opened once to release
  // the pre-exec grandchild it leaves parked in open(2).
  const childBuns: Bun.Subprocess[] = [];
  const fifos: string[] = [];
  afterAll(() => {
    for (const proc of childBuns) proc.kill("SIGKILL");
    for (const fifo of fifos) {
      for (const flags of [constants.O_WRONLY, constants.O_RDONLY]) {
        try {
          closeSync(openSync(fifo, flags | constants.O_NONBLOCK));
        } catch {}
      }
    }
  });

  async function runInChildBun(script: string) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    childBuns.push(proc);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
  }

  function makeFifo(dir: string) {
    const fifo = join(dir, "stdio.fifo");
    mkfifo(fifo);
    fifos.push(fifo);
    return fifo;
  }

  // Nothing ever opens these fifos for writing, so the child reads EOF.
  test.concurrent("Bun.spawn with a stdin fifo nobody writes to returns", async () => {
    using dir = tempDir("spawn-fifo-stdin", {});
    const fifo = makeFifo(String(dir));

    const result = await runInChildBun(`
      const proc = Bun.spawn(["cat"], { stdin: Bun.file(${JSON.stringify(fifo)}), stdout: "pipe", stderr: "inherit" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      console.log(JSON.stringify({ stdout, exitCode }));
    `);

    expect(result).toEqual({
      stdout: JSON.stringify({ stdout: "", exitCode: 0 }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("Bun.spawnSync with a stdin fifo nobody writes to returns", async () => {
    using dir = tempDir("spawn-fifo-stdin-sync", {});
    const fifo = makeFifo(String(dir));

    const result = await runInChildBun(`
      const { exitCode, stdout } = Bun.spawnSync(["cat"], { stdin: Bun.file(${JSON.stringify(fifo)}), stderr: "inherit" });
      console.log(JSON.stringify({ stdout: stdout.toString(), exitCode }));
    `);

    expect(result).toEqual({
      stdout: JSON.stringify({ stdout: "", exitCode: 0 }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("Bun.spawn throws ENXIO for a stdout fifo with no reader instead of waiting for one", async () => {
    using dir = tempDir("spawn-fifo-stdout", {});
    const fifo = makeFifo(String(dir));

    const result = await runInChildBun(`
      try {
        const proc = Bun.spawn(${versionCmd}, { stdout: Bun.file(${JSON.stringify(fifo)}) });
        proc.kill();
        console.log(JSON.stringify({ spawned: true }));
      } catch (err) {
        console.log(JSON.stringify({ code: err.code, syscall: err.syscall, path: err.path }));
      }
    `);

    expect(result).toEqual({
      stdout: JSON.stringify({ code: "ENXIO", syscall: "open", path: fifo }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("the child does not inherit the O_NONBLOCK used to open the path", async () => {
    using dir = tempDir("spawn-stdio-blocking", { "input.txt": "" });

    // Same value on Linux, macOS and FreeBSD.
    const F_GETFL = 3;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { dlopen } = require("bun:ffi");
          const { O_NONBLOCK } = require("node:fs").constants;
          const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, { fcntl: { args: ["i32", "i32"], returns: "i32" } });
          const flags = libc.symbols.fcntl(0, ${F_GETFL});
          console.log(JSON.stringify({ fcntlFailed: flags < 0, nonblocking: (flags & O_NONBLOCK) !== 0 }));
        `,
      ],
      env: bunEnv,
      stdin: Bun.file(join(String(dir), "input.txt")),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ fcntlFailed: false, nonblocking: false }),
      stderr: "",
      exitCode: 0,
    });
  });
});

describe("Bun.file(path) as stdio errors", () => {
  function thrownBy(fn: () => unknown): unknown {
    try {
      fn();
    } catch (err) {
      return err;
    }
    throw new Error("expected the spawn to throw");
  }

  const errorFields = (err: any) => ({ code: err.code, syscall: err.syscall, path: err.path });

  describe.each(["spawn", "spawnSync"] as const)("%s", kind => {
    const spawnWith = (options: object) =>
      kind === "spawn"
        ? thrownBy(() => Bun.spawn([bunExe(), "--version"], options).kill())
        : thrownBy(() => Bun.spawnSync([bunExe(), "--version"], options));

    test.concurrent("stdin: Bun.file(missing) throws ENOENT and does not create the file", () => {
      using dir = tempDir("spawn-stdin-missing", {});
      const missing = join(String(dir), "does-not-exist.txt");

      const err = spawnWith({ stdin: Bun.file(missing), stdout: "ignore", stderr: "ignore" });

      expect({ ...errorFields(err), created: existsSync(missing) }).toEqual({
        code: "ENOENT",
        syscall: "open",
        path: missing,
        created: false,
      });
    });

    test.concurrent("stdin: Bun.file(directory) throws EISDIR", () => {
      using dir = tempDir("spawn-stdin-dir", {});

      const err = spawnWith({ stdin: Bun.file(String(dir)), stdout: "ignore", stderr: "ignore" });

      expect(errorFields(err)).toEqual({ code: "EISDIR", syscall: "open", path: String(dir) });
    });

    test.concurrent.each([
      ["stdout", (file: Bun.BunFile) => ({ stdout: file, stderr: "ignore" })],
      ["stderr", (file: Bun.BunFile) => ({ stdout: "ignore", stderr: file })],
      ["stdio[3]", (file: Bun.BunFile) => ({ stdio: ["ignore", "ignore", "ignore", file] })],
    ])("%s: Bun.file() in a missing directory reports the file's path, not the command", (_, options) => {
      using dir = tempDir("spawn-stdio-missing-dir", {});
      const out = join(String(dir), "no-such-dir", "out.txt");

      const err = spawnWith(options(Bun.file(out)));

      expect(errorFields(err)).toEqual({ code: "ENOENT", syscall: "open", path: out });
    });
  });
});

test("a relative Bun.file() stdio path resolves against the parent's cwd, not the cwd option", async () => {
  using dir = tempDir("spawn-stdio-relative", { "parent/.keep": "", "child/.keep": "" });
  const parentCwd = join(String(dir), "parent");
  const childCwd = join(String(dir), "child");

  const result = await bunRun([
    "-e",
    `
      process.chdir(${JSON.stringify(parentCwd)});
      const { exitCode } = Bun.spawnSync(${versionCmd}, { cwd: ${JSON.stringify(childCwd)}, stdout: Bun.file("out.txt") });
      console.log(JSON.stringify({ exitCode }));
    `,
  ]);

  expect({
    result,
    inParentCwd: existsSync(join(parentCwd, "out.txt")),
    inChildCwd: existsSync(join(childCwd, "out.txt")),
  }).toEqual({
    result: { stdout: JSON.stringify({ exitCode: 0 }), stderr: "", exitCode: 0, signalCode: null },
    inParentCwd: true,
    inChildCwd: false,
  });
});
