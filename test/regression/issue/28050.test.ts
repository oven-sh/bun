import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("process.title setter updates OS process title on Linux", async () => {
  const customTitle = "bun-test-28050";

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
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

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
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

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
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.title).toBe(longTitle);
  expect(exitCode).toBe(0);
});
