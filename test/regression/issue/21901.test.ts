import { test, expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// https://github.com/oven-sh/bun/issues/21901
test("mkdir('.') should succeed with recursive option on Windows", async () => {
  if (!isWindows) {
    test.skip();
    return;
  }

  // Test mkdirSync with recursive option
  {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require('fs');
        try {
          fs.mkdirSync('.', { recursive: true });
          console.log('mkdirSync success');
        } catch (err) {
          console.error('mkdirSync error:', err.message);
          process.exit(1);
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("mkdirSync success");
    expect(exitCode).toBe(0);
  }

  // Test mkdir with recursive option (promise)
  {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require('fs').promises;
        (async () => {
          try {
            await fs.mkdir('.', { recursive: true });
            console.log('mkdir success');
          } catch (err) {
            console.error('mkdir error:', err.message);
            process.exit(1);
          }
        })();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("mkdir success");
    expect(exitCode).toBe(0);
  }

  // Test Promise.allSettled with multiple mkdir('.') calls
  {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require('fs').promises;
        (async () => {
          try {
            const results = await Promise.allSettled([
              fs.mkdir('.', { recursive: true }),
              fs.mkdir('.', { recursive: true }),
              fs.mkdir('.', { recursive: true }),
            ]);

            const allSucceeded = results.every(r => r.status === 'fulfilled');
            if (allSucceeded) {
              console.log('Promise.allSettled success');
            } else {
              const failed = results.filter(r => r.status === 'rejected');
              console.error('Some promises failed:', failed.map(f => f.reason?.message).join(', '));
              process.exit(1);
            }
          } catch (err) {
            console.error('Promise.allSettled error:', err.message);
            process.exit(1);
          }
        })();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("Promise.allSettled success");
    expect(exitCode).toBe(0);
  }
});
