// https://github.com/oven-sh/bun/issues/24003
// Async stack traces were missing their `at async <fn>` frames when an
// AsyncLocalStorage store was active at the point of `await`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(source: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

function asyncFrames(stack: string): string[] {
  return stack
    .split("\n")
    .filter(l => l.includes("at async "))
    .map(l => l.trim().replace(/ \(.*\)$/, ""));
}

describe.concurrent("issue #24003", () => {
  test("async stack frames under AsyncLocalStorage.run()", async () => {
    const stdout = await run(`
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    async function fn3() { await 0; throw new Error("boom"); }
    async function fn2() { await fn3(); }
    async function fn1() { await fn2(); }
    async function main() {
      try { await als.run({}, () => fn1()); }
      catch (e) { console.log(e.stack); }
    }
    main();
  `);
    expect(stdout).toContain("at fn3");
    expect(asyncFrames(stdout)).toEqual(["at async fn2", "at async fn1", "at async main"]);
  });

  test("async stack frames under AsyncLocalStorage.enterWith()", async () => {
    const stdout = await run(`
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    als.enterWith({ x: 1 });
    async function inner() { await 0; console.log(new Error("boom").stack); }
    async function outer() { await inner(); }
    async function main() { await outer(); }
    main();
  `);
    expect(stdout).toContain("at inner");
    expect(asyncFrames(stdout)).toEqual(["at async outer", "at async main"]);
  });

  test("async stack frames through Promise.race under AsyncLocalStorage", async () => {
    const stdout = await run(`
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    async function leaf() { await 0; throw new Error("boom"); }
    async function viaRace() { await Promise.race([leaf()]); }
    async function caller() { await viaRace(); }
    async function main() {
      try { await als.run({}, () => caller()); }
      catch (e) { console.log(e.stack); }
    }
    main();
  `);
    expect(stdout).toContain("at leaf");
    expect(asyncFrames(stdout)).toEqual(["at async viaRace", "at async caller", "at async main"]);
  });

  // The hook is installed lazily from the AsyncLocalStorage constructor; construct one
  // without entering a store so the lockstep walk runs but JSC succeeds at every hop.
  test("async stack frames are not duplicated when no AsyncLocalStorage store is active", async () => {
    const stdout = await run(`
    new (require("node:async_hooks").AsyncLocalStorage)();
    async function fn3() { await 0; throw new Error("boom"); }
    async function fn2() { await fn3(); }
    async function fn1() { await fn2(); }
    async function main() {
      try { await fn1(); }
      catch (e) { console.log(e.stack); }
    }
    main();
  `);
    expect(stdout).toContain("at fn3");
    expect(asyncFrames(stdout)).toEqual(["at async fn2", "at async fn1", "at async main"]);
  });

  test("async stack frames through Promise.race are not duplicated when no AsyncLocalStorage store is active", async () => {
    const stdout = await run(`
    new (require("node:async_hooks").AsyncLocalStorage)();
    async function leaf() { await 0; throw new Error("boom"); }
    async function viaRace() { await Promise.race([leaf()]); }
    async function caller() { await viaRace(); }
    async function main() {
      try { await caller(); }
      catch (e) { console.log(e.stack); }
    }
    main();
  `);
    expect(stdout).toContain("at leaf");
    expect(asyncFrames(stdout)).toEqual(["at async viaRace", "at async caller", "at async main"]);
  });

  test("async stack frames when AsyncLocalStorage is entered mid-chain", async () => {
    // fn2 awaits fn3 before ALS is entered, so JSC's own walk finds fn2; fn1
    // awaits fn2 after enterWith, so JSC stops there and the hook must supply
    // fn1/main without duplicating fn2.
    const stdout = await run(`
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    async function fn3() { await 0; throw new Error("boom"); }
    async function fn2() { await fn3(); }
    async function fn1() {
      const p = fn2();
      als.enterWith({});
      await p;
    }
    async function main() {
      try { await fn1(); }
      catch (e) { console.log(e.stack); }
    }
    main();
  `);
    expect(stdout).toContain("at fn3");
    expect(asyncFrames(stdout)).toEqual(["at async fn2", "at async fn1", "at async main"]);
  });
});
