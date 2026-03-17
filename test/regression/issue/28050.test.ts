import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.skipIf(process.platform !== "linux")("process.title setter updates OS process title on Linux", async () => {
  const customTitle = "bun-test-28050-long";

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.title = "${customTitle}";
      // On Linux, prctl(PR_SET_NAME) is limited to 16 chars including null.
      // Read /proc/self/comm to verify the OS-level title was set.
      const fs = require("fs");
      const comm = process.platform === "linux"
        ? fs.readFileSync("/proc/self/comm", "utf8").trim()
        : null;
      console.log(JSON.stringify({ comm, jsTitle: process.title }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  // The JS-level title should always be set correctly
  expect(result.jsTitle).toBe(customTitle);

  // On Linux, /proc/self/comm should reflect the prctl'd name (truncated to 15 chars)
  if (process.platform === "linux") {
    expect(result.comm).toBe(customTitle.slice(0, 15));
  }

  expect(exitCode).toBe(0);
});

test("process.title setter handles empty string", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.title = "";
      console.log(JSON.stringify({ title: process.title }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.title).toBe("");
  expect(exitCode).toBe(0);
});

test("process.title setter handles long titles", async () => {
  const longTitle = Buffer.alloc(256, "a").toString();

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.title = Buffer.alloc(256, "a").toString();
      console.log(JSON.stringify({ title: process.title }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.title).toBe(longTitle);
  expect(exitCode).toBe(0);
});

test("process.title can be set multiple times", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.title = "first-title";
      process.title = "second-title";
      process.title = "third-title";
      console.log(JSON.stringify({ title: process.title }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.title).toBe("third-title");
  expect(exitCode).toBe(0);
});

test.skipIf(process.platform !== "darwin")("process.title setter updates pthread name on macOS", async () => {
  const customTitle = "bun-test-28050";

  // The child process sets process.title and then reads back the OS-level
  // pthread name via pthread_getname_np using bun:ffi to verify the kernel
  // actually received the new name.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { dlopen, ptr } = require("bun:ffi");

      process.title = "${customTitle}";

      // Open libc and resolve pthread_self + pthread_getname_np
      const lib = dlopen("libc.dylib", {
        pthread_self: { args: [], returns: "ptr" },
        pthread_getname_np: { args: ["ptr", "ptr", "usize"], returns: "int" },
      });

      const buf = new Uint8Array(64);
      const self = lib.symbols.pthread_self();
      lib.symbols.pthread_getname_np(self, ptr(buf), buf.length);
      const threadName = new (require("bun:ffi").CString)(ptr(buf));

      console.log(JSON.stringify({
        jsTitle: process.title,
        threadName: threadName.toString(),
      }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.jsTitle).toBe(customTitle);
  // pthread_setname_np was called — the OS-level thread name should match
  expect(result.threadName).toBe(customTitle);
  expect(exitCode).toBe(0);
});
