import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { exec, type ExecException, type ExecOptions } from "node:child_process";
import path from "node:path";

const SIZE = 262145;
const EQUALS = Buffer.alloc(SIZE, "=");

const cwd = tempDirWithFiles("child-process-exec", { "equals.txt": EQUALS });
const readCommand = isWindows ? "type equals.txt" : "cat equals.txt";
const echoArgvFixture = path.join(import.meta.dir, "fixtures", "child-process-echo-argv.js");

function execAsync(command: string, options: ExecOptions) {
  const { promise, resolve } = Promise.withResolvers<{
    err: ExecException | null;
    stdout: string | Buffer;
    stderr: string | Buffer;
  }>();
  const child = exec(command, { env: bunEnv, ...options }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  return { child, promise };
}

// https://github.com/oven-sh/bun/issues/5319
describe.concurrent("child_process.exec", () => {
  describe.each(["stdout", "stderr"])("%s", io => {
    const command = io === "stdout" ? readCommand : `${readCommand} 1>&2`;
    const split = (stdout: string | Buffer, stderr: string | Buffer) =>
      io === "stdout" ? { out: stdout, other: stderr } : { out: stderr, other: stdout };

    test("no encoding", async () => {
      const { err, stdout, stderr } = await execAsync(command, {
        cwd,
        maxBuffer: 1024 * 1024 * 10,
        encoding: "buffer",
      }).promise;
      expect(err).toBeNull();
      const { out, other } = split(stdout, stderr);
      expect(out).toBeInstanceOf(Buffer);
      expect(out).toEqual(EQUALS);
      expect(other).toEqual(Buffer.alloc(0));
    });

    test("Infinity maxBuffer", async () => {
      const { err, stdout, stderr } = await execAsync(command, { cwd, maxBuffer: Infinity }).promise;
      expect(err).toBeNull();
      const { out, other } = split(stdout, stderr);
      expect(out).toBe(EQUALS.toString());
      expect(other).toBe("");
    });

    test("large output", async () => {
      const { err, stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 1024 * 1024 * 10 }).promise;
      expect(err).toBeNull();
      const { out, other } = split(stdout, stderr);
      expect(out).toBe(EQUALS.toString());
      expect(other).toBe("");
    });

    // 1024 * 255 - 1 is 1026 bytes short of the output, so the cut is near its end.
    test.each([1024 * 100, 1024 * 255 - 1])("exceeding maxBuffer %d truncates the output", async maxBuffer => {
      const { err, stdout, stderr } = await execAsync(command, { cwd, maxBuffer }).promise;
      expect(err).toMatchObject({
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        message: `${io} maxBuffer length exceeded`,
        cmd: command,
      });
      const { out, other } = split(stdout, stderr);
      expect(out).toBe(EQUALS.toString("utf8", 0, maxBuffer));
      expect(other).toBe("");
    });
  });

  test("shell option names the shell that runs the command", async () => {
    // $0 is the shell's argv[0]. cmd.exe has no $0, but %CMDCMDLINE% is its
    // whole command line, which starts with argv[0]. The default shell would
    // print /bin/sh or the full path from %ComSpec% instead.
    const shell = isWindows ? "cmd.exe" : Bun.which("bash")!;
    const command = isWindows ? "echo %CMDCMDLINE%" : "echo $0";
    const { err, stdout, stderr } = await execAsync(command, { shell }).promise;
    expect(err).toBeNull();
    expect(stdout).toBe(isWindows ? `cmd.exe /d /s /c "${command}"\r\n` : `${shell}\n`);
    expect(stderr).toBe("");
  });

  test("shell option with a missing shell fails with ENOENT", async () => {
    const shell = isWindows ? "no-such-shell.exe" : "/no/such/shell";
    const { err, stdout, stderr } = await execAsync("echo hi", { shell }).promise;
    expect(err).toMatchObject({ code: "ENOENT", cmd: "echo hi", path: shell, spawnargs: ["-c", "echo hi"] });
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

test.concurrent("exec with verbatim arguments", async () => {
  const { child, promise } = execAsync(`${bunExe()} ${echoArgvFixture} tasklist /FI "IMAGENAME eq chrome.exe"`, {});
  expect(child.pid).toBeGreaterThan(0);

  const { err, stdout, stderr } = await promise;
  expect(err).toBeNull();
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual([`tasklist`, `/FI`, `IMAGENAME eq chrome.exe`]);
});
