import { describe, expect, test } from "bun:test";
import { bunExe, isWindows } from "harness";
import { exec } from "node:child_process";

const SIZE = 262145;

// https://github.com/oven-sh/bun/issues/5319
describe("child_process.exec", () => {
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

test("exec with verbatim arguments", async () => {
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
