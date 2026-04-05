import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("fs.readFile async error has .stack property", async () => {
  using dir = tempDir("issue-28644", {});
  const missingPath = join(String(dir), "no-such-file");

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require('fs');
      fs.readFile(${JSON.stringify(missingPath)}, (err) => {
        if (!err) { process.exit(1); }
        console.log(JSON.stringify({
          type: typeof err.stack,
          stack: err.stack,
          isError: err instanceof Error,
        }));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const { type, stack, isError } = JSON.parse(stdout.trim());
  expect(type).toBe("string");
  expect(stack).toMatch(/^Error: /);
  expect(stack).toContain("ENOENT");
  expect(isError).toBe(true);
  expect(exitCode).toBe(0);
});

test("fs.stat async error has .stack property", async () => {
  using dir = tempDir("issue-28644", {});
  const missingPath = join(String(dir), "no-such-file");

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require('fs');
      fs.stat(${JSON.stringify(missingPath)}, (err) => {
        if (!err) { process.exit(1); }
        console.log(JSON.stringify({
          type: typeof err.stack,
          stack: err.stack,
        }));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const { type, stack } = JSON.parse(stdout.trim());
  expect(type).toBe("string");
  expect(stack).toMatch(/^Error: /);
  expect(stack).toContain("ENOENT");
  expect(exitCode).toBe(0);
});

test("fs.promises.readFile rejected error has .stack property", async () => {
  using dir = tempDir("issue-28644", {});
  const missingPath = join(String(dir), "no-such-file");

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require('fs').promises;
      fs.readFile(${JSON.stringify(missingPath)}).catch((err) => {
        console.log(JSON.stringify({
          type: typeof err.stack,
          stack: err.stack,
        }));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const { type, stack } = JSON.parse(stdout.trim());
  expect(type).toBe("string");
  expect(stack).toMatch(/^Error: /);
  expect(stack).toContain("ENOENT");
  expect(exitCode).toBe(0);
});

test("fs.access async error has .stack property", async () => {
  using dir = tempDir("issue-28644", {});
  const missingPath = join(String(dir), "no-such-file");

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require('fs');
      fs.access(${JSON.stringify(missingPath)}, (err) => {
        if (!err) { process.exit(1); }
        console.log(JSON.stringify({
          type: typeof err.stack,
          stack: err.stack,
        }));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const { type, stack } = JSON.parse(stdout.trim());
  expect(type).toBe("string");
  expect(stack).toMatch(/^Error: /);
  expect(stack).toContain("ENOENT");
  expect(exitCode).toBe(0);
});
