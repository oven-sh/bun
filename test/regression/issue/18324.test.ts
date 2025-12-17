import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Issue #18324: Async generator function are not properly identified in console.log
// https://github.com/oven-sh/bun/issues/18324
//
// When logging an async generator, Bun shows `{}` instead of something like
// `Object [AsyncGenerator] {}` (Node.js) or `AsyncGenerator {}`.

test("console.log should properly identify async generator objects", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
async function* arrayToIter(requests) {
  for (const request of requests) {
    yield await Promise.resolve(request);
  }
}
console.log(arrayToIter([]));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should NOT be just `{}` - should contain some identifier for AsyncGenerator
  expect(stdout.trim()).not.toBe("{}");
  // Should contain "AsyncGenerator" in the output
  expect(stdout).toContain("AsyncGenerator");

  expect(exitCode).toBe(0);
});

test("console.log should properly identify regular generator objects", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function* gen() {
  yield 1;
  yield 2;
}
console.log(gen());
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should NOT be just `{}` - should contain some identifier for Generator
  expect(stdout.trim()).not.toBe("{}");
  // Should contain "Generator" in the output
  expect(stdout).toContain("Generator");

  expect(exitCode).toBe(0);
});

test("console.log shows generator state when it has yielded values", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
async function* asyncGen() {
  yield 1;
  yield 2;
}
const g = asyncGen();
await g.next(); // consume first value
console.log(g);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should contain AsyncGenerator identifier
  expect(stdout).toContain("AsyncGenerator");

  expect(exitCode).toBe(0);
});

test("Bun.inspect should properly identify async generator", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
async function* asyncGen() {
  yield 1;
}
console.log(Bun.inspect(asyncGen()));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should contain AsyncGenerator identifier
  expect(stdout).toContain("AsyncGenerator");

  expect(exitCode).toBe(0);
});
