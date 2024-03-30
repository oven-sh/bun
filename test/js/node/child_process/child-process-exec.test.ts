import { test, expect, describe } from "bun:test";
import { exec } from "node:child_process";

// https://github.com/oven-sh/bun/issues/5319
describe("child_process.exec", () => {
  describe.each(["stdout", "stderr"])("%s", io => {
    const script = io === "stdout" ? `printf '=%.0s' {1..262145}` : `printf '=%.0s' {1..262145} 1>&2`;

    test("no encoding", async () => {
      const { resolve, reject, promise } = Promise.withResolvers();
      exec(
        script,
        { maxBuffer: 1024 * 1024 * 10, encoding: "buffer", shell: Bun.which("bash") },
        (err, stdout, stderr) => {
          if (err) {
            reject(err);
          } else {
            resolve({ stdout, stderr });
          }
        },
      );
      const { stdout, stderr } = await promise;
      const out = io === "stdout" ? stdout : stderr;
      const other = io === "stdout" ? stderr : stdout;
      expect(out).toHaveLength(262145);
      expect(out).toBeInstanceOf(Buffer);
      expect(other).toEqual(Buffer.alloc(0));
    });

    test("Infinity maxBuffer", async () => {
      const { resolve, reject, promise } = Promise.withResolvers();
      exec(script, { maxBuffer: Infinity, shell: Bun.which("bash") }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
      const { stdout, stderr } = await promise;
      const out = io === "stdout" ? stdout : stderr;
      const other = io === "stdout" ? stderr : stdout;
      expect(out).toHaveLength(262145);
      expect(other).toBe("");
    });

    test("large output", async () => {
      const { resolve, reject, promise } = Promise.withResolvers();
      exec(script, { maxBuffer: 1024 * 1024 * 10, shell: Bun.which("bash") }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
      const { stdout, stderr } = await promise;
      const out = io === "stdout" ? stdout : stderr;
      const other = io === "stdout" ? stderr : stdout;
      expect(out).toHaveLength(262145);
      expect(other).toBe("");
    });

    test("exceeding maxBuffer should throw", async () => {
      const { resolve, reject, promise } = Promise.withResolvers();
      exec(script, { maxBuffer: 1024 * 1024, shell: Bun.which("bash") }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
      expect(promise).rejects.toThrow("maxBuffer length exceeded");
    });
  });
});
