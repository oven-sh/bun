import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// https://github.com/oven-sh/bun/issues/28861
// `new Worker("file://./worker.mjs")` used to silently drop the `.` host and
// try to load `/worker.mjs`. Match Node's behavior: reject non-empty,
// non-"localhost" hosts synchronously with a TypeError.
test.skipIf(isWindows)("new Worker() rejects file:// URLs with a non-localhost host", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        try {
          new Worker("file://./worker_source.mjs", { type: "module" });
          console.log("NO_THROW");
        } catch (e) {
          console.log(JSON.stringify({ name: e.name, message: e.message }));
        }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  const platform = process.platform === "darwin" ? "darwin" : "linux";
  expect(JSON.parse(stdout.trim())).toEqual({
    name: "TypeError",
    message: `File URL host must be "localhost" or empty on ${platform}`,
  });
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)('new Worker() rejects file:// URLs with a host like "example.com"', async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        try {
          new Worker("file://example.com/worker_source.mjs", { type: "module" });
          console.log("NO_THROW");
        } catch (e) {
          console.log(JSON.stringify({ name: e.name, message: e.message }));
        }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  const platform = process.platform === "darwin" ? "darwin" : "linux";
  expect(JSON.parse(stdout.trim())).toEqual({
    name: "TypeError",
    message: `File URL host must be "localhost" or empty on ${platform}`,
  });
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("new Worker() accepts file:// URLs with empty or localhost host", async () => {
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

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
});
