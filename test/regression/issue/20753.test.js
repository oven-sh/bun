import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe.skipIf(isWindows /* accessing posix-specific paths */)("stdout should always be a string", () => {
  test("execFile returns string stdout/stderr even when process fails to spawn", done => {
    // Test case that would cause the issue: non-existent command
    execFile("/does/not/exist", [], (err, stdout, stderr) => {
      expect(err).toBeTruthy();
      expect(err.code).toBe("ENOENT");

      // These should never be undefined - they should be strings by default
      expect(stdout).toBeDefined();
      expect(stderr).toBeDefined();
      expect(typeof stdout).toBe("string");
      expect(typeof stderr).toBe("string");
      expect(stdout).toBe("");
      expect(stderr).toBe("");

      // This is what claude-code was trying to do that failed
      expect(() => stdout.trim()).not.toThrow();
      expect(() => stderr.trim()).not.toThrow();

      done();
    });
  });

  test("execFile returns string stdout/stderr for permission denied errors", done => {
    // Another edge case: file exists but not executable
    execFile("/etc/passwd", [], (err, stdout, stderr) => {
      expect(err).toBeTruthy();
      expect(err.code).toBe("EACCES");

      expect(stdout).toBeDefined();
      expect(stderr).toBeDefined();
      expect(typeof stdout).toBe("string");
      expect(typeof stderr).toBe("string");
      expect(stdout).toBe("");
      expect(stderr).toBe("");

      done();
    });
  });

  test("execFile returns Buffer stdout/stderr when encoding is 'buffer'", done => {
    execFile("/does/not/exist", [], { encoding: "buffer" }, (err, stdout, stderr) => {
      expect(err).toBeTruthy();
      expect(err.code).toBe("ENOENT");

      expect(stdout).toBeDefined();
      expect(stderr).toBeDefined();
      expect(Buffer.isBuffer(stdout)).toBe(true);
      expect(Buffer.isBuffer(stderr)).toBe(true);
      expect(stdout.length).toBe(0);
      expect(stderr.length).toBe(0);

      done();
    });
  });

  test("execFile promisified version includes stdout/stderr in error object", async () => {
    try {
      await execFileAsync("/does/not/exist", []);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err.code).toBe("ENOENT");

      // Promisified version attaches stdout/stderr to the error object
      expect(err.stdout).toBeDefined();
      expect(err.stderr).toBeDefined();
      expect(typeof err.stdout).toBe("string");
      expect(typeof err.stderr).toBe("string");
      expect(err.stdout).toBe("");
      expect(err.stderr).toBe("");
    }
  });

  test("execFile returns stdout/stderr for process that exits with error code", done => {
    execFile(
      process.execPath,
      ["-e", "console.log('output'); console.error('error'); process.exit(1)"],
      (err, stdout, stderr) => {
        expect(err).toBeTruthy();
        expect(err.code).toBe(1);

        expect(stdout).toBeDefined();
        expect(stderr).toBeDefined();
        expect(typeof stdout).toBe("string");
        expect(typeof stderr).toBe("string");
        expect(stdout).toBe("output\n");
        expect(stderr).toBe("error\n");

        done();
      },
    );
  });

  test("execFile handles fast-exiting processes correctly", done => {
    // Process that exits immediately
    execFile("true", [], (err, stdout, stderr) => {
      expect(err).toBeNull();

      expect(stdout).toBeDefined();
      expect(stderr).toBeDefined();
      expect(typeof stdout).toBe("string");
      expect(typeof stderr).toBe("string");
      expect(stdout).toBe("");
      expect(stderr).toBe("");

      done();
    });
  });
});
