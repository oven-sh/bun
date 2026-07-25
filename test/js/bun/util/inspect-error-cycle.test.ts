// Error-graph cycle / deep-chain segfaults in the native error printer.
// The AggregateError `errors` recursion had no stack check and no visited
// set, so self/mutual cycles and very deep nesting hit the stack guard page
// (silent SIGSEGV) via `print_errorlike_object` -> `for_each` -> `agg_iter`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

type Shape = { name: string; build: string };
type Sink = { name: string; wrap: (b: string) => string; allowFail: boolean };

const shapes: Shape[] = [
  {
    name: "self-cycle",
    build: `const ae = new AggregateError([], "self"); ae.errors = [ae]; const e = ae;`,
  },
  {
    name: "mutual-cycle",
    build: `const a = new AggregateError([], "A"); const b = new AggregateError([], "B"); a.errors = [b]; b.errors = [a]; const e = a;`,
  },
  {
    name: "deleted-errors",
    build: `const ae = new AggregateError([new Error("x")], "del"); delete ae.errors; const e = ae;`,
  },
  {
    name: "accessor-errors",
    build: `const ae = new AggregateError([], "acc"); Object.defineProperty(ae, "errors", { get() { throw new Error("boom"); } }); const e = ae;`,
  },
  {
    name: "non-iterable-errors",
    build: `const ae = new AggregateError([], "ni"); ae.errors = 42; const e = ae;`,
  },
  {
    name: "mixed-agg-cause",
    build: `const a = new AggregateError([], "A"); const c = new Error("C"); a.errors = [c]; c.cause = a; const e = a;`,
  },
];

const sinks: Sink[] = [
  { name: "console.log", wrap: b => `${b} console.log(e);`, allowFail: false },
  { name: "console.error", wrap: b => `${b} console.error(e);`, allowFail: false },
  { name: "Bun.inspect", wrap: b => `${b} Bun.inspect(e);`, allowFail: false },
  { name: "uncaught-throw", wrap: b => `${b} throw e;`, allowFail: true },
  {
    name: "unhandled-reject",
    wrap: b => `${b} Promise.reject(e); await 1;`,
    allowFail: true,
  },
  {
    name: "uncaughtException-handler",
    wrap: b => `process.on("uncaughtException", err => { console.error(err); process.exit(0); }); ${b} throw e;`,
    allowFail: false,
  },
];

describe.concurrent("error-graph cycles do not crash the printer", () => {
  for (const shape of shapes) {
    for (const sink of sinks) {
      const cell = `${shape.name} x ${sink.name}`;
      test(cell, async () => {
        const code = sink.wrap(shape.build);
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--no-install", "-e", code],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        if (proc.signalCode) {
          throw new Error(
            `crashed with ${proc.signalCode}\nstdout: ${stdout.slice(0, 300)}\nstderr: ${stderr.slice(0, 300)}`,
          );
        }
        if (sink.allowFail) {
          expect(exitCode).toBeLessThan(128);
        } else {
          if (exitCode !== 0) {
            throw new Error(`exit ${exitCode}\nstdout: ${stdout.slice(0, 300)}\nstderr: ${stderr.slice(0, 300)}`);
          }
          expect(exitCode).toBe(0);
        }
      });
    }
  }
});

// Release bun segfaults at ~2000 levels.
describe.concurrent("error-graph depth does not crash the printer", () => {
  const deepAgg = `let x = new AggregateError([], "leaf"); for (let i = 0; i < 3000; i++) x = new AggregateError([x], "n" + i); const e = x;`;
  const deepCause = `let x = new Error("leaf"); for (let i = 0; i < 3000; i++) x = new Error("n" + i, { cause: x }); const e = x;`;

  for (const sink of sinks) {
    test(`deep-aggregate x ${sink.name}`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--no-install", "-e", sink.wrap(deepAgg)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(proc.signalCode).toBeFalsy();
      if (sink.allowFail) expect(exitCode).toBeLessThan(128);
      else expect(exitCode).toBe(0);
    });
  }

  // The cause-chain depth guard exists but was inert on the uncaught /
  // rejection path because the formatter's stack_check was never seated.
  for (const sink of sinks.filter(s => s.allowFail)) {
    test(`deep-cause x ${sink.name}`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--no-install", "-e", sink.wrap(deepCause)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(proc.signalCode).toBeFalsy();
      expect(exitCode).toBeLessThan(128);
    });
  }
});

describe.concurrent("AggregateError printer output", () => {
  test("self-cycle renders [Circular] and includes the header", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ae = new AggregateError([], "outer"); ae.errors = [ae]; process.stdout.write(Bun.inspect(ae));`,
      ],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("[Circular]");
    expect(stdout).toContain("outer");
    expect(exitCode).toBe(0);
  });

  test("uncaught AggregateError prints its own message", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `throw new AggregateError([new Error("inner")], "outer message");`],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("outer message");
    expect(stderr).toContain("inner");
    expect(exitCode).toBe(1);
  });

  test("deleted errors property prints header", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ae = new AggregateError([new Error("x")], "msg"); delete ae.errors; process.stdout.write(Bun.inspect(ae));`,
      ],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("msg");
    expect(exitCode).toBe(0);
  });
});
