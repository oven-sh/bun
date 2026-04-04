import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/18477
// Bun's transpiler was inlining const values across switch case boundaries,
// which suppressed the TDZ ReferenceError that should occur when a const
// declared in one case is referenced from another case that executes without
// the declaring case having been entered.
test("const in switch case should not be inlined across case boundaries", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      try {
        switch ('A') {
          case 'B':
            const message = 'Started with A';
            console.log(message);
          case 'A':
            console.log(message);
        }
        console.log("NO ERROR");
      } catch(e) {
        console.log(e.constructor.name);
      }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("ReferenceError");
  expect(exitCode).toBe(0);
});

test("const in switch case with default should not be inlined", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      try {
        switch ('C') {
          case 'A':
            const val = 100;
          default:
            console.log(val);
        }
        console.log("NO ERROR");
      } catch(e) {
        console.log(e.constructor.name);
      }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("ReferenceError");
  expect(exitCode).toBe(0);
});

test("const inlining still works outside of switch", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const x = 42;
      console.log(x);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("42");
  expect(exitCode).toBe(0);
});
