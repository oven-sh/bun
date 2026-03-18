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
  // On Windows, the getter reads via uv_get_process_title which returns
  // empty for "", and the getter falls back to "bun".
  if (process.platform === "win32") {
    expect(result.title).toBe("bun");
  } else {
    expect(result.title).toBe("");
  }
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

test.skipIf(process.platform !== "darwin")(
  "process.title setter updates LaunchServices display name on macOS",
  async () => {
    const customTitle = "bun-test-28050";

    // Spawn a child that sets process.title, prints its PID, then waits for
    // stdin to close. This keeps the process alive so the parent can query
    // its LaunchServices display name via lsappinfo.
    await using child = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
      process.title = "${customTitle}";
      // Signal readiness with PID
      console.log(JSON.stringify({ pid: process.pid, jsTitle: process.title }));
      // Stay alive until parent closes stdin
      await new Promise(resolve => process.stdin.on("end", resolve));
      `,
      ],
      env: bunEnv,
      stdin: "pipe",
      stderr: "pipe",
    });

    // Read the child's PID from its stdout
    const reader = child.stdout.getReader();
    const { value } = await reader.read();
    if (!value) throw new Error("child closed stdout without writing JSON");
    const info = JSON.parse(new TextDecoder().decode(value).trim());
    expect(info.jsTitle).toBe(customTitle);

    // Query LaunchServices for the child's display name via lsappinfo
    await using lsProc = Bun.spawn({
      cmd: ["lsappinfo", "info", "-only", "name", `pid=${info.pid}`],
      env: bunEnv,
      stderr: "pipe",
    });
    const [lsStdout, lsExitCode] = await Promise.all([lsProc.stdout.text(), lsProc.exited]);

    // lsappinfo outputs: "LSDisplayName"="<title>"
    const match = lsStdout.match(/"LSDisplayName"\s*=\s*"([^"]*)"/);

    // Let child exit
    child.stdin.end();
    reader.releaseLock();
    const childExit = await child.exited;

    // On headless CI (no WindowServer), LaunchServices check-in may fail
    // silently, so lsappinfo may not find the process. Only assert when
    // lsappinfo actually returned data.
    if (match) {
      expect(match[1]).toBe(customTitle);
    }
    expect(childExit).toBe(0);
  },
);
