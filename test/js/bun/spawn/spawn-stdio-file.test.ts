// A `Bun.file(path)` at a stdio slot is opened for the child by path. The slot
// decides the open flags: stdin reads, stdout and stderr replace the file, and
// an extra slot is opened for reading and writing with its content kept.
import type { BunFile } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { closeSync, existsSync, openSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const OLD = "OLD-CONTENT-0123456789ABCDEF";
// The children use fs on the fd numbers: process.stdout and process.stdin load slowly in a debug build.
const writeStdout = `require("fs").writeSync(1, "NEW")`;
const echoStdin = `const fs = require("fs"); fs.writeSync(1, fs.readFileSync(0))`;

// Writes "NEW" to `fd`. On the other stream it reports how large the file at `fd` was when the child started.
const sizeThenWrite = (fd: 1 | 2) =>
  `const fs = require("fs"); fs.writeSync(${fd === 1 ? 2 : 1}, String(fs.fstatSync(${fd}).size)); fs.writeSync(${fd}, "NEW")`;

describe("Bun.file(path) as stdout or stderr replaces the file", () => {
  // The other output stream is a pipe: the child reports on it.
  const forms: { slot: string; fd: 1 | 2; stdio: (file: BunFile) => object }[] = [
    { slot: "stdout", fd: 1, stdio: file => ({ stdout: file, stderr: "pipe" }) },
    { slot: "stderr", fd: 2, stdio: file => ({ stderr: file, stdout: "pipe" }) },
    { slot: "stdio[1]", fd: 1, stdio: file => ({ stdio: ["ignore", file, "pipe"] }) },
    { slot: "stdio[2]", fd: 2, stdio: file => ({ stdio: ["ignore", "pipe", file] }) },
  ];
  // The file is empty when the child starts, and holds only the new output when the child exits.
  const replaced = { sizeAtStart: "0", file: "NEW", exitCode: 0 };

  describe.concurrent("Bun.spawn", () => {
    test.each(forms)("$slot", async ({ fd, stdio }) => {
      using dir = tempDir("spawn-stdio-file", { "out.txt": OLD });
      const out = join(String(dir), "out.txt");
      await using proc = Bun.spawn<"ignore", "pipe", "pipe">({
        cmd: [bunExe(), "-e", sizeThenWrite(fd)],
        env: bunEnv,
        ...stdio(Bun.file(out)),
      });
      const [sizeAtStart, exitCode] = await Promise.all([(fd === 1 ? proc.stderr : proc.stdout).text(), proc.exited]);
      expect({ sizeAtStart, file: readFileSync(out, "utf8"), exitCode }).toEqual(replaced);
    });

    test("a child that writes nothing leaves an empty file", async () => {
      using dir = tempDir("spawn-stdio-file", { "out.txt": OLD });
      const out = join(String(dir), "out.txt");
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", "0"], env: bunEnv, stdout: Bun.file(out) });
      const exitCode = await proc.exited;
      expect(readFileSync(out, "utf8")).toBe("");
      expect(exitCode).toBe(0);
    });

    // The way to filter a file in place: the file is read before stdout empties it.
    test("stdin from the bytes of the file that stdout replaces", async () => {
      using dir = tempDir("spawn-stdio-file", { "both.txt": OLD });
      const both = join(String(dir), "both.txt");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `const fs = require("fs"); fs.writeSync(1, fs.readFileSync(0, "utf8").toLowerCase())`],
        env: bunEnv,
        stdin: await Bun.file(both).bytes(),
        stdout: Bun.file(both),
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      expect(readFileSync(both, "utf8")).toBe(OLD.toLowerCase());
      expect(exitCode).toBe(0);
    });
  });

  describe("Bun.spawnSync", () => {
    test.each(forms)("$slot", ({ fd, stdio }) => {
      using dir = tempDir("spawn-stdio-file", { "out.txt": OLD });
      const out = join(String(dir), "out.txt");
      const { stdout, stderr, exitCode } = Bun.spawnSync<"ignore", "pipe", "pipe">({
        cmd: [bunExe(), "-e", sizeThenWrite(fd)],
        env: bunEnv,
        ...stdio(Bun.file(out)),
      });
      const sizeAtStart = (fd === 1 ? stderr : stdout).toString();
      expect({ sizeAtStart, file: readFileSync(out, "utf8"), exitCode }).toEqual(replaced);
    });
  });

  // Bun opens the file before it starts the command, so a command that cannot start leaves an empty file.
  // A command that is not in PATH fails before the open.
  test.each([
    { name: "is already empty when the command cannot be executed", command: "./no-such-command", file: "" },
    { name: "is kept when the command is not in PATH", command: "no-such-command-for-spawn-stdio-file", file: OLD },
  ])("the file $name", ({ command, file }) => {
    using dir = tempDir("spawn-stdio-file", { "out.txt": OLD });
    const out = join(String(dir), "out.txt");
    let code: unknown;
    try {
      Bun.spawnSync({ cmd: [command], cwd: String(dir), env: bunEnv, stdout: Bun.file(out) });
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code;
    }
    expect({ code, file: readFileSync(out, "utf8") }).toEqual({ code: "ENOENT", file });
  });

  // stdout and stderr empty the file before the child reads stdin, so one regular file at both is an error.
  describe("the same Bun.file(path) as stdin and as stdout or stderr", () => {
    type Spawned = { exitCode: number | null; exited?: Promise<number> };
    const slots: { name: string; stdio: (file: BunFile) => object }[] = [
      { name: "stdin and stdout", stdio: file => ({ stdin: file, stdout: file }) },
      { name: "stdin and stderr", stdio: file => ({ stdin: file, stderr: file }) },
      { name: "stdio[0] and stdio[1]", stdio: file => ({ stdio: [file, file, "inherit"] }) },
      { name: "stdio[0] and stdio[2]", stdio: file => ({ stdio: [file, "ignore", file] }) },
    ];
    const sameFile = "stdin cannot be the same file as stdout or stderr";

    describe.each(["spawn", "spawnSync"] as const)("Bun.%s", method => {
      const run = (path: string, stdio = slots[0].stdio, script = echoStdin) =>
        (Bun[method] as (options: object) => Spawned)({
          cmd: [bunExe(), "-e", script],
          env: bunEnv,
          ...stdio(Bun.file(path)),
        });

      test.each(slots)("$name: throws and keeps the file", ({ stdio }) => {
        using dir = tempDir("spawn-stdio-file", { "both.txt": OLD });
        const both = join(String(dir), "both.txt");
        expect(() => run(both, stdio)).toThrow(
          /stdin cannot be the same file as stdout or stderr: the command would read an empty ".*both\.txt"/,
        );
        expect(readFileSync(both, "utf8")).toBe(OLD);
      });

      test("throws for an empty file", () => {
        using dir = tempDir("spawn-stdio-file", { "empty.txt": "" });
        expect(() => run(join(String(dir), "empty.txt"))).toThrow(sameFile);
      });

      test("throws for a file that does not exist, and does not create it", () => {
        using dir = tempDir("spawn-stdio-file", {});
        const missing = join(String(dir), "missing.txt");
        expect(() => run(missing)).toThrow(sameFile);
        expect(existsSync(missing)).toBe(false);
      });

      test.skipIf(isWindows)("throws for a symlink to a file, and keeps the file", () => {
        using dir = tempDir("spawn-stdio-file", { "target.txt": OLD });
        const link = join(String(dir), "link.txt");
        symlinkSync(join(String(dir), "target.txt"), link);
        expect(() => run(link)).toThrow(sameFile);
        expect(readFileSync(link, "utf8")).toBe(OLD);
      });

      // The open cannot empty a device, so the command loses no input.
      test("runs the command when the path is a device", async () => {
        const proc = run("/dev/null", slots[0].stdio, "process.exit(42)");
        expect(await (proc.exited ?? proc.exitCode)).toBe(42);
      });

      // Only a regular file and a missing file throw. Every other path goes to the open.
      test.skipIf(isWindows)("a path below a file fails in the open, with ENOTDIR", () => {
        using dir = tempDir("spawn-stdio-file", { "file.txt": OLD });
        let code: unknown;
        try {
          run(join(String(dir), "file.txt", "below"));
        } catch (error) {
          code = (error as NodeJS.ErrnoException).code;
        }
        expect(code).toBe("ENOTDIR");
      });
    });

    // On POSIX the child can open a relative path under `cwd`, where a stat from the parent finds another file.
    // Here `data` is a directory for the parent and a regular file in `sub`.
    test.skipIf(isWindows).each(["spawn", "spawnSync"] as const)(
      "Bun.%s throws for a relative path with cwd, and keeps the file",
      async method => {
        using dir = tempDir("spawn-stdio-file", { "data/placeholder.txt": "", "sub/data": OLD });
        const script = `
          const options = {
            cmd: [process.execPath, "-e", ${JSON.stringify(echoStdin)}],
            cwd: "sub",
            stdin: Bun.file("data"),
            stdout: Bun.file("data"),
          };
          let message = "";
          try {
            await Bun.${method}(options).exited;
          } catch (error) {
            message = error.message;
          }
          console.log(JSON.stringify({ message, file: require("fs").readFileSync("sub/data", "utf8") }));
        `;
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", script],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "inherit",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect(JSON.parse(stdout)).toEqual({ message: expect.stringContaining(sameFile), file: OLD });
        expect(exitCode).toBe(0);
      },
    );

    // `terminal` takes stdin, stdout and stderr, so Bun opens neither file.
    test("with terminal, the command runs and the file is kept", async () => {
      using dir = tempDir("spawn-stdio-file", { "both.txt": OLD });
      const both = join(String(dir), "both.txt");
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "process.exit(42)"],
        env: bunEnv,
        terminal: { data() {} },
        stdin: Bun.file(both),
        stdout: Bun.file(both),
      });
      const exitCode = await proc.exited;
      proc.terminal?.close();
      expect({ exitCode, file: readFileSync(both, "utf8") }).toEqual({ exitCode: 42, file: OLD });
    });
  });

  describe.skipIf(!isWindows)("on Windows", () => {
    const attrib = (dir: string, change: string) =>
      Bun.spawnSync(["cmd", "/C", `attrib ${change} out.txt`], { cwd: dir, stdio: ["ignore", "ignore", "ignore"] })
        .exitCode;

    // CREATE_ALWAYS refuses a hidden file, so bun opens it in place and truncates it.
    test("a hidden file is replaced", () => {
      using dir = tempDir("spawn-stdio-file", { "out.txt": OLD });
      const out = join(String(dir), "out.txt");
      expect(attrib(String(dir), "+h")).toBe(0);
      const { exitCode } = Bun.spawnSync({ cmd: [bunExe(), "-e", writeStdout], env: bunEnv, stdout: Bun.file(out) });
      expect(readFileSync(out, "utf8")).toBe("NEW");
      expect(exitCode).toBe(0);
    });

    test("a read-only file fails with EPERM and keeps its content", () => {
      using dir = tempDir("spawn-stdio-file", { "out.txt": OLD });
      const out = join(String(dir), "out.txt");
      expect(attrib(String(dir), "+r")).toBe(0);
      let code: unknown;
      try {
        Bun.spawnSync({ cmd: [bunExe(), "-e", writeStdout], env: bunEnv, stdout: Bun.file(out) });
      } catch (error) {
        code = (error as NodeJS.ErrnoException).code;
      } finally {
        // tempDir cannot remove a read-only file on Windows.
        attrib(String(dir), "-r");
      }
      expect({ code, file: readFileSync(out, "utf8") }).toEqual({ code: "EPERM", file: OLD });
    });
  });
});

describe.concurrent("slots that keep the content of the file", () => {
  test("Bun.file(path) as stdin is read and not truncated", async () => {
    using dir = tempDir("spawn-stdio-file", { "in.txt": OLD });
    const input = join(String(dir), "in.txt");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", echoStdin],
      env: bunEnv,
      stdin: Bun.file(input),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, file: readFileSync(input, "utf8") }).toEqual({ stdout: OLD, file: OLD });
    expect(exitCode).toBe(0);
  });

  test("Bun.file(path) at index 3 keeps the file, and creates a file that does not exist", async () => {
    using dir = tempDir("spawn-stdio-file", { "existing.txt": OLD });
    const files: Record<string, string> = {};
    for (const name of ["existing.txt", "created.txt"]) {
      const extra = join(String(dir), name);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", "0"],
        env: bunEnv,
        stdio: ["ignore", "inherit", "inherit", Bun.file(extra)],
      });
      expect(await proc.exited).toBe(0);
      files[name] = readFileSync(extra, "utf8");
    }
    expect(files).toEqual({ "existing.txt": OLD, "created.txt": "" });
  });

  // Windows: same exclusion as "Bun.file(path) at index >= 3 is readable in the child" in spawn.test.ts.
  test.skipIf(isWindows)("a write through Bun.file(path) at index 3 keeps the rest of the file", async () => {
    using dir = tempDir("spawn-stdio-file", { "extra.txt": OLD });
    const extra = join(String(dir), "extra.txt");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `require("fs").writeSync(3, "NEW")`],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit", Bun.file(extra)],
    });
    const exitCode = await proc.exited;
    expect(readFileSync(extra, "utf8")).toBe("NEW" + OLD.slice(3));
    expect(exitCode).toBe(0);
  });

  // The way to append or to write in place: the caller opens the file and passes the fd.
  test.each([
    { flags: "r+", as: "a number", expected: "NEW" + OLD.slice(3) },
    { flags: "r+", as: "Bun.file(fd)", expected: "NEW" + OLD.slice(3) },
    { flags: "a", as: "a number", expected: OLD + "NEW" },
  ])(`a file descriptor opened with "$flags" as stdout, passed as $as`, async ({ flags, as, expected }) => {
    using dir = tempDir("spawn-stdio-file", { "out.txt": OLD });
    const out = join(String(dir), "out.txt");
    const fd = openSync(out, flags);
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", writeStdout],
        env: bunEnv,
        stdout: as === "a number" ? fd : Bun.file(fd),
      });
      const exitCode = await proc.exited;
      expect(readFileSync(out, "utf8")).toBe(expected);
      expect(exitCode).toBe(0);
    } finally {
      closeSync(fd);
    }
  });

  // One fd is one open file: stdout and stderr share its offset.
  test("one file descriptor as stdout and stderr keeps both streams", async () => {
    using dir = tempDir("spawn-stdio-file", {});
    const out = join(String(dir), "out.txt");
    const fd = openSync(out, "w");
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `const fs = require("fs"); fs.writeSync(1, "out\\n"); fs.writeSync(2, "err\\n")`],
        env: bunEnv,
        stdout: fd,
        stderr: fd,
      });
      const exitCode = await proc.exited;
      expect(readFileSync(out, "utf8").split("\n").sort()).toEqual(["", "err", "out"]);
      expect(exitCode).toBe(0);
    } finally {
      closeSync(fd);
    }
  });
});

describe("Bun.spawnSync, a slot above stderr", () => {
  test("Bun.file(path) at index 4 keeps the file", () => {
    using dir = tempDir("spawn-stdio-file", { "extra.txt": OLD });
    const extra = join(String(dir), "extra.txt");
    const { exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "0"],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit", "ignore", Bun.file(extra)],
    });
    expect(readFileSync(extra, "utf8")).toBe(OLD);
    expect(exitCode).toBe(0);
  });
});
