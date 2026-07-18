import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(execArgv: string[], src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...execArgv, "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("process.emitWarning default stderr report", () => {
  test.concurrent("a user 'warning' listener does not suppress the stderr report", async () => {
    const src = `
      const util = require("node:util");
      process.on("warning", () => {});
      util.deprecate(() => 1, "dep msg A", "DEP0T1")();
      setTimeout(() => {}, 30);
    `;
    const { stderr, exitCode } = await run([], src);
    const first = stderr.split("\n")[0];
    expect(first).toMatch(/^\(\w+:\d+\) \[DEP0T1\] DeprecationWarning: dep msg A$/);
    expect(exitCode).toBe(0);
  });

  test.concurrent("default report uses Node's one-line (name:pid) [CODE] form", async () => {
    const src = `
      const util = require("node:util");
      util.deprecate(() => 1, "dep msg B", "DEP0T2")();
    `;
    const { stderr, exitCode } = await run([], src);
    const lines = stderr.split("\n");
    expect(lines[0]).toMatch(/^\(\w+:\d+\) \[DEP0T2\] DeprecationWarning: dep msg B$/);
    expect(lines[1]).toMatch(/--trace-deprecation/);
    // No stack frames printed by default.
    expect(stderr).not.toMatch(/^\s+at /m);
    expect(exitCode).toBe(0);
  });

  test.concurrent("process.emitWarning with code and detail formats Node-style", async () => {
    const src = `process.emitWarning("plain msg", { type: "CustomWarning", code: "CODE9", detail: "some detail" });`;
    const { stderr, exitCode } = await run([], src);
    const lines = stderr.split("\n");
    expect(lines[0]).toMatch(/^\(\w+:\d+\) \[CODE9\] CustomWarning: plain msg$/);
    expect(lines[1]).toBe("some detail");
    expect(lines[2]).toMatch(/--trace-warnings/);
    expect(exitCode).toBe(0);
  });

  test.concurrent("--throw-deprecation does not leak internal builtin source", async () => {
    const src = `
      const util = require("node:util");
      util.deprecate(() => 1, "dep msg C", "DEP0T3")();
    `;
    const { stderr, exitCode } = await run(["--throw-deprecation"], src);
    // The thrown DeprecationWarning's stack must start at the user's call
    // site, not inside the internal util/deprecate emitter, so no builtin
    // source snippet (with raw @-intrinsic syntax) should appear.
    expect(stderr).not.toMatch(/getDeprecationWarningEmitter/);
    expect(stderr).not.toMatch(/@undefined/);
    expect(stderr).not.toMatch(/internal:util\/deprecate/);
    expect(stderr).toContain("DeprecationWarning: dep msg C");
    expect(exitCode).toBe(1);
  });

  test.concurrent("NODE_NO_WARNINGS=1 still delivers the event but suppresses stderr", async () => {
    const src = `
      process.on("warning", w => console.log("event:" + w.name + ":" + w.code));
      process.emitWarning("hush", "DeprecationWarning", "DEP0T4");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: { ...bunEnv, NODE_NO_WARNINGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toMatch(/DEP0T4|DeprecationWarning/);
    expect(stdout).toBe("event:DeprecationWarning:DEP0T4\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--trace-deprecation prints the warning stack instead of the hint", async () => {
    const src = `
      const util = require("node:util");
      util.deprecate(() => 1, "dep msg E", "DEP0T5")();
    `;
    const { stderr, exitCode } = await run(["--trace-deprecation"], src);
    expect(stderr.split("\n")[0]).toMatch(/^\(\w+:\d+\) \[DEP0T5\] DeprecationWarning: dep msg E$/);
    expect(stderr).toMatch(/^\s+at /m);
    expect(stderr).not.toMatch(/internal:util\/deprecate/);
    expect(stderr).not.toContain("--trace-deprecation ...");
    expect(exitCode).toBe(0);
  });

  test.concurrent("passing an Error instance leaves its .stack untouched even when ctor is given", async () => {
    const src = `
      function outer() {
        const e = new Error("boom");
        const orig = e.stack;
        process.emitWarning(e, { ctor: outer });
        process.emitWarning(e, "Type", "CODE", outer);
        console.log(e.stack === orig ? "same" : "changed");
      }
      outer();
    `;
    const { stdout, exitCode } = await run([], src);
    expect(stdout).toBe("same\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--trace-warnings prints the warning stack for non-deprecation warnings", async () => {
    const src = `process.emitWarning("trace me", "CustomWarning", "CODE10");`;
    const { stderr, exitCode } = await run(["--trace-warnings"], src);
    expect(stderr.split("\n")[0]).toMatch(/^\(\w+:\d+\) \[CODE10\] CustomWarning: trace me$/);
    expect(stderr).toMatch(/^\s+at /m);
    expect(stderr).not.toMatch(/at emitWarning/);
    expect(stderr).not.toContain("--trace-warnings ...");
    expect(exitCode).toBe(0);
  });

  test.concurrent("process.traceDeprecation = true enables stack printing at runtime", async () => {
    const src = `
      process.traceDeprecation = true;
      require("node:util").deprecate(() => 1, "dep msg F", "DEP0T6")();
    `;
    const { stderr, exitCode } = await run([], src);
    expect(stderr.split("\n")[0]).toMatch(/^\(\w+:\d+\) \[DEP0T6\] DeprecationWarning: dep msg F$/);
    expect(stderr).toMatch(/^\s+at /m);
    expect(stderr).not.toContain("--trace-deprecation ...");
    expect(exitCode).toBe(0);
  });
});
