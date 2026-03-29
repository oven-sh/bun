import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("fs.readFile async error has .stack property", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require('fs');
      fs.readFile('nonexistentfile', (err) => {
        if (!err) { process.exit(1); }
        console.log(typeof err.stack);
        console.log(err.stack);
        console.log(err instanceof Error);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  expect(lines[0]).toBe("string");
  expect(lines[1]).toContain("ENOENT");
  expect(lines[1]).toContain("nonexistentfile");
  expect(lines[2]).toBe("true");
  expect(exitCode).toBe(0);
});

test("fs.stat async error has .stack property", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require('fs');
      fs.stat('nonexistentfile', (err) => {
        if (!err) { process.exit(1); }
        console.log(typeof err.stack);
        console.log(err.stack);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  expect(lines[0]).toBe("string");
  expect(lines[1]).toContain("ENOENT");
  expect(exitCode).toBe(0);
});

test("fs.promises.readFile rejected error has .stack property", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require('fs').promises;
      fs.readFile('nonexistentfile').catch((err) => {
        console.log(typeof err.stack);
        console.log(err.stack);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  expect(lines[0]).toBe("string");
  expect(lines[1]).toContain("ENOENT");
  expect(exitCode).toBe(0);
});

test("fs.access async error has .stack property", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require('fs');
      fs.access('nonexistentfile', (err) => {
        if (!err) { process.exit(1); }
        console.log(typeof err.stack);
        console.log(err.stack);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  expect(lines[0]).toBe("string");
  expect(lines[1]).toContain("ENOENT");
  expect(exitCode).toBe(0);
});
