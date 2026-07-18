import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// These assertions inspect fresh-process state of the `Bun` global (static
// properties not yet reified, `bun` module cache untouched). When the full
// suite runs many test files in one process, earlier files have already
// spread `Bun` and `await import('bun')`-ed, so run each check in its own
// subprocess so the result is independent of test ordering.

test("hasNonReifiedStatic", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { hasNonReifiedStatic } = require("bun:internal-for-testing");
       const { env } = require("bun");
       if (hasNonReifiedStatic(Bun) !== true)
         throw new Error("Bun was eagerly initialized before first access");
       if (env.a !== undefined) throw new Error("env.a should be undefined");
       if (hasNonReifiedStatic(Bun) !== true)
         throw new Error("destructuring env must not reify Bun");
       const a = { ...Bun };
       globalThis.a = a;
       if (hasNonReifiedStatic(Bun) !== false)
         throw new Error("spreading Bun should reify its static properties");
       console.log("ok");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test("require('bun')", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const str = eval("'bun'");
       if (require(str) !== Bun) throw new Error("require('bun') !== Bun");
       console.log("ok");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test("await import('bun')", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const str = eval("'bun'");
       const BunESM = await import(str);
       // Iterate all fields so we crash if any is in an unexpected state.
       console.log(BunESM);
       for (let property in Bun) {
         if (!(property in BunESM)) throw new Error("BunESM missing " + property);
         if (BunESM[property] !== Bun[property])
           throw new Error("BunESM." + property + " !== Bun." + property);
       }
       if (BunESM.default !== Bun) throw new Error("BunESM.default !== Bun");
       console.error("ok");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("ok\n");
  // stdout carries the console.log(BunESM) dump; we only care it didn't crash.
  expect(stdout.length).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});
