import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// Runs the real REPRL wrapper (src/js/eval/fuzzilli-reprl.ts) over mocked REPRL
// FDs, one exec cycle per program. The fixture prints one line per status the
// wrapper reports back to the fuzzer: the status word (0x100 is exit code 1,
// i.e. the program failed) and the markers the programs pushed onto the global
// `ran` array by the time that status was written.
async function runReprl(programs: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl.fixture.ts"), JSON.stringify(programs)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// APIs that intentionally kill the process outside of normal exception handling
// must be stubbed out before the loop starts, otherwise every fuzz case reaching
// them is reported as a crash. process.execve is one of those: on success it
// replaces the process image, which would silently end the REPRL loop.
test.concurrent("REPRL loop survives a program that calls process.execve", async () => {
  const { stdout, stderr, exitCode } = await runReprl([
    `process.execve("fuzzilli-reprl-execve-does-not-exist", []);`,
    `ran.push("still alive");`,
  ]);

  expect(stdout).toMatchInlineSnapshot(`
    "status=0x0 ran=[]
    status=0x0 ran=["still alive"]
    "
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// The loop is synchronous, so nothing drains the microtask queue between
// programs unless the wrapper does it itself. Each program's promise reactions,
// await continuations and nextTicks have to run before its status is written
// (so their coverage and crashes are attributed to it), and a failure that only
// surfaces there has to fail that program's status just like a synchronous
// throw does.
test.concurrent("REPRL loop runs each program's microtasks before reporting its status", async () => {
  const { stdout, stderr, exitCode } = await runReprl([
    `Promise.resolve().then(() => ran.push("then"));
     (async () => { await null; ran.push("await"); })();
     process.nextTick(() => ran.push("nextTick"));`,
    `(async () => { await null; throw new Error("rejected after await"); })();`,
    `queueMicrotask(() => { throw new Error("thrown from a microtask"); });`,
    `Promise.resolve().then(() => ran.push("then queued before the throw"));
     throw new Error("thrown synchronously");`,
    // Coercing this value to a string throws. An uncaughtException listener that
    // throws takes the whole process down, so it must be reported without that.
    `queueMicrotask(() => { throw { [Symbol.toPrimitive]() { throw new Error("unprintable"); } }; });`,
    `ran.push("clean program after failed ones");`,
  ]);

  expect(stdout).toMatchInlineSnapshot(`
    "status=0x0 ran=["await","nextTick","then"]
    uncaught:Error: rejected after await
    status=0x100 ran=[]
    uncaught:Error: thrown from a microtask
    status=0x100 ran=[]
    uncaught:Error: thrown synchronously
    status=0x100 ran=["then queued before the throw"]
    uncaught:<unprintable>
    status=0x100 ran=[]
    status=0x0 ran=["clean program after failed ones"]
    "
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
