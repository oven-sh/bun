// https://github.com/oven-sh/bun/issues/24003
// Async stack traces were truncated to a single frame inside
// AsyncLocalStorage.run() because the JSPromiseReaction context is wrapped in
// an InternalFieldTuple when an async context is active, and
// Interpreter::getAsyncStackTrace didn't unwrap it before casting to
// JSGenerator*.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const fixture = /* ts */ `
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();

async function fn1() {
  await Bun.sleep(1);
  await fn2();
}
async function fn2() {
  await Bun.sleep(1);
  await fn3();
}
async function fn3() {
  await Bun.sleep(1);
  throw new Error("boom");
}

async function outer() {
  await als.run({}, async function inner() {
    await fn1();
  });
}

try {
  await outer();
} catch (e) {
  console.log((e as Error).stack);
}
`;

test("async stack frames are preserved inside AsyncLocalStorage.run()", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  // Before the fix only `fn3` appeared; the parent async frames were dropped.
  expect(stdout).toContain("at fn3 ");
  expect(stdout).toContain("at async fn2 ");
  expect(stdout).toContain("at async fn1 ");
  expect(stdout).toContain("at async inner ");
  expect(stdout).toContain("at async outer ");
  expect(exitCode).toBe(0);
});

test("async stack frames are preserved through Promise.all inside AsyncLocalStorage.run()", async () => {
  const combinatorFixture = /* ts */ `
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();

async function leaf() {
  await Bun.sleep(1);
  throw new Error("boom");
}
async function mid() {
  await Bun.sleep(1);
  await leaf();
}
async function top() {
  await Promise.all([mid()]);
}

try {
  await als.run({}, async function wrap() {
    await top();
  });
} catch (e) {
  console.log((e as Error).stack);
}
`;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", combinatorFixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("at leaf ");
  expect(stdout).toContain("at async mid ");
  expect(stdout).toContain("at async top ");
  expect(stdout).toContain("at async wrap ");
  expect(exitCode).toBe(0);
});
