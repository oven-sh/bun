import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

// https://github.com/oven-sh/bun/issues/11845
describe.concurrent("unhandled rejection inside a ShadowRealm", () => {
  it("is reported as an unhandled rejection", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = new ShadowRealm();
         r.evaluate("Promise.reject(new Error('boom-from-realm')); undefined");`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stdout).toBe("");
    expect(stderr).toContain("boom-from-realm");
    expect(exitCode).toBe(1);
  });

  it("from an async function is reported", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = new ShadowRealm();
         const run = r.evaluate(
           "() => { (async () => { throw new Error('async-boom'); })(); }"
         );
         run();`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stdout).toBe("");
    expect(stderr).toContain("async-boom");
    expect(exitCode).toBe(1);
  });

  it("reaches process.on('unhandledRejection')", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.on("unhandledRejection", (err) => {
           console.log("caught", err.message);
           process.exit(0);
         });
         const r = new ShadowRealm();
         r.evaluate("Promise.reject(new Error('handled-by-process')); undefined");
         setTimeout(() => process.exit(2), 1000);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("caught handled-by-process\n");
    expect(exitCode).toBe(0);
  });

  it("is not reported when caught inside the realm", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.on("unhandledRejection", () => {
           console.error("unhandledRejection fired");
           process.exit(1);
         });
         const r = new ShadowRealm();
         r.evaluate("Promise.reject(new Error('should-be-caught')).catch(() => {}); undefined");
         await new Promise(queueMicrotask);
         console.log("ok");`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });

  it("emits rejectionHandled when caught after being reported", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.on("unhandledRejection", () => console.log("unhandled"));
         process.on("rejectionHandled", () => {
           console.log("handled");
           process.exit(0);
         });
         const r = new ShadowRealm();
         const attach = r.evaluate(
           "var p = Promise.reject(new Error('late')); () => { p.catch(() => {}); }"
         );
         setTimeout(() => { attach(); setTimeout(() => process.exit(2), 1000); }, 0);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("unhandled\nhandled\n");
    expect(exitCode).toBe(0);
  });
});
