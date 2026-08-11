import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { exec, execFile } from "node:child_process";

const SIZE = 262145;

// https://github.com/oven-sh/bun/issues/5319
describe.concurrent("child_process.exec", () => {
  const shell = Bun.which(isWindows ? "powershell" : "bash");

  describe.each(["stdout", "stderr"])("%s", io => {
    let script;
    if (isWindows) {
      if (io === "stdout") {
        script = `[Console]::Out.Write.Invoke('=' * ${SIZE})`;
      } else {
        script = `[Console]::Error.Write.Invoke('=' * ${SIZE})`;
      }
    } else {
      if (io === "stdout") {
        script = `printf '=%.0s' {1..${SIZE}}`;
      } else {
        script = `printf '=%.0s' {1..${SIZE}} 1>&2`;
      }
    }

    test("no encoding", async () => {
      const { resolve, reject, promise } = Promise.withResolvers();
      exec(script, { maxBuffer: 1024 * 1024 * 10, encoding: "buffer", shell }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
      const { stdout, stderr } = await promise;
      const out = io === "stdout" ? stdout : stderr;
      const other = io === "stdout" ? stderr : stdout;
      expect(out).toHaveLength(SIZE);
      expect(out).toBeInstanceOf(Buffer);
      expect(other).toEqual(Buffer.alloc(0));
    });

    test("Infinity maxBuffer", async () => {
      const { resolve, reject, promise } = Promise.withResolvers();
      exec(script, { maxBuffer: Infinity, shell }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
      const { stdout, stderr } = await promise;
      const out = io === "stdout" ? stdout : stderr;
      const other = io === "stdout" ? stderr : stdout;
      expect(out).toHaveLength(SIZE);
      expect(other).toBe("");
    });

    test("large output", async () => {
      const { resolve, reject, promise } = Promise.withResolvers();
      exec(script, { maxBuffer: 1024 * 1024 * 10, shell }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
      const { stdout, stderr } = await promise;
      const out = io === "stdout" ? stdout : stderr;
      const other = io === "stdout" ? stderr : stdout;
      expect(out).toHaveLength(SIZE);
      expect(other).toBe("");
    });

    test("exceeding maxBuffer should throw", async () => {
      const { resolve, reject, promise } = Promise.withResolvers();
      exec(script, { maxBuffer: 1024 * 100, shell }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, err });
      });
      const { stdout, stderr, err } = await promise;
      expect(err.message).toContain("maxBuffer length exceeded");
      expect(err.message).toContain(io);
      const out = io === "stdout" ? stdout : stderr;
      const other = io === "stdout" ? stderr : stdout;
      expect(out.trim()).toHaveLength(1024 * 100);
      expect(other).toBe("");
    });

    test("exceeding maxBuffer should truncate output length", async () => {
      const { resolve, reject, promise } = Promise.withResolvers();
      exec(script, { maxBuffer: 1024 * 255 - 1, shell }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, err });
      });
      const { stdout, stderr, err } = await promise;
      expect(err.message).toContain("maxBuffer length exceeded");
      expect(err.message).toContain(io);
      const out = (io === "stdout" ? stdout : stderr).trim();
      const other = (io === "stdout" ? stderr : stdout).trim();
      expect(out.length).toBeLessThanOrEqual(1024 * 255 - 1);
      expect(out.length).toBeGreaterThan(1024 * 100);
      expect(other).toBe("");
    });
  });
});

// Regression: a chunk already queued in the pipe when kill()/destroy() fires
// was being appended past maxBuffer because slice(0, negative) keeps a tail.
// Needs a writer that fills the pipe faster than the reader drains it; a
// debug-build Bun child starts too slowly to trigger it, so use head(1).
describe.concurrent.each(["buffer", "utf8"] as const)("maxBuffer cap with fast writer (%s)", enc => {
  test.skipIf(isWindows)("stdout never exceeds maxBuffer", async () => {
    const maxBuffer = 64 * 1024;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => {
        const { promise, resolve } = Promise.withResolvers<{ code: unknown; len: number }>();
        execFile(
          "head",
          ["-c", String(4 * 1024 * 1024), "/dev/zero"],
          { maxBuffer, encoding: enc, env: bunEnv },
          (err, stdout) => resolve({ code: (err as NodeJS.ErrnoException | null)?.code, len: stdout.length }),
        );
        return promise;
      }),
    );
    expect(results).toEqual(
      Array.from({ length: 10 }, () => ({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", len: maxBuffer })),
    );
  });
});

test.concurrent("exec with verbatim arguments", async () => {
  const { resolve, reject, promise } = Promise.withResolvers();

  const fixture = require.resolve("./fixtures/child-process-echo-argv.js");
  const child = exec(`${bunExe()} ${fixture} tasklist /FI "IMAGENAME eq chrome.exe"`, (err, stdout, stderr) => {
    if (err) return reject(err);
    return resolve({ stdout, stderr });
  });
  expect(!!child).toBe(true);

  const { stdout } = await promise;
  expect(stdout.trim().split("\n")).toEqual([`tasklist`, `/FI`, `IMAGENAME eq chrome.exe`]);
});
