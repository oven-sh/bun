import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// https://github.com/oven-sh/bun/issues/28861
function filterStderr(s: string): string {
  // Strip the ASAN JSC-signal-handler warning emitted by debug builds so we
  // can still assert `stderr === ""` from the subprocess.
  return s
    .split(/\r?\n/)
    .filter(line => line.length > 0 && !line.startsWith("WARNING: ASAN interferes"))
    .join("\n");
}

describe.skipIf(isWindows).concurrent("issue/28861", () => {
  test("new Worker() rejects file:// URLs with a non-localhost host", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        try {
          new Worker("file://./worker_source.mjs", { type: "module" });
          console.log("NO_THROW");
        } catch (e) {
          console.log(JSON.stringify({ name: e.name, message: e.message, code: e.code }));
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const platform = process.platform === "darwin" ? "darwin" : "linux";
    expect(filterStderr(stderr)).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      name: "TypeError",
      message: `File URL host must be "localhost" or empty on ${platform}`,
      code: "ERR_INVALID_FILE_URL_HOST",
    });
    expect(exitCode).toBe(0);
  });

  test('new Worker() rejects file:// URLs with a host like "example.com"', async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        try {
          new Worker("file://example.com/worker_source.mjs", { type: "module" });
          console.log("NO_THROW");
        } catch (e) {
          console.log(JSON.stringify({ name: e.name, message: e.message, code: e.code }));
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const platform = process.platform === "darwin" ? "darwin" : "linux";
    expect(filterStderr(stderr)).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      name: "TypeError",
      message: `File URL host must be "localhost" or empty on ${platform}`,
      code: "ERR_INVALID_FILE_URL_HOST",
    });
    expect(exitCode).toBe(0);
  });

  test("new Worker() rejects file:// URLs in the preload option with a non-localhost host", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        try {
          new Worker("file:///nonexistent_worker_12345.mjs", {
            type: "module",
            preload: ["file://example.com/preload.mjs"],
          });
          console.log("NO_THROW");
        } catch (e) {
          console.log(JSON.stringify({ name: e.name, message: e.message, code: e.code }));
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const platform = process.platform === "darwin" ? "darwin" : "linux";
    expect(filterStderr(stderr)).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      name: "TypeError",
      message: `File URL host must be "localhost" or empty on ${platform}`,
      code: "ERR_INVALID_FILE_URL_HOST",
    });
    expect(exitCode).toBe(0);
  });

  test("new Worker() accepts file:// URLs with empty or localhost host", async () => {
    // Validate we don't break file:/// (empty host) or file://localhost/ URLs.
    // We use a nonexistent path so the Worker's load fails asynchronously — the
    // constructor itself must NOT throw.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        try {
          new Worker("file:///nonexistent_worker_12345.mjs", { type: "module" });
          new Worker("file://localhost/nonexistent_worker_12345.mjs", { type: "module" });
          console.log("OK");
        } catch (e) {
          console.log("UNEXPECTED_THROW:" + e.message);
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("OK");
    expect(exitCode).toBe(0);
  });
});
