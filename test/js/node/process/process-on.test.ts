import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

describe("process.on", () => {
  it("when called from the main thread", () => {
    const result = Bun.spawnSync({
      cmd: [bunExe(), path.join(__dirname, "process-on-fixture.ts")],
      env: bunEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(result.exitCode).toBe(0);
  });

  it("should work inside --compile", () => {
    using dir = tempDir("process-on-test", {
      "process-on-fixture.ts": require("fs").readFileSync(require.resolve("./process-on-fixture.ts"), "utf-8"),
      "package.json": `{
        "name": "process-on-test",
        "type": "module",
        "scripts": {
          "start": "bun run process-on-fixture.ts"
        }
      }`,
    });
    const result1 = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", path.join(dir, "./process-on-fixture.ts"), "--outfile=./out"],
      env: bunEnv,
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(result1.exitCode).toBe(0);

    const result2 = Bun.spawnSync({
      cmd: ["./out"],
      env: bunEnv,
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(result2.exitCode).toBe(0);
  });

  it("should work inside a macro", () => {
    using dir = tempDir("process-on-test", {
      "process-on-fixture.ts": require("fs").readFileSync(require.resolve("./process-on-fixture.ts"), "utf-8"),
      "entry.ts": `import { initialize } from "./process-on-fixture.ts" with {type: "macro"};
      initialize();`,
      "package.json": `{
        "name": "process-on-test",
        "type": "module",
        "scripts": {
          "start": "bun run entry.ts"
        }
      }`,
    });

    expect(
      Bun.spawnSync({
        cmd: [bunExe(), "build", "--target=bun", path.join(dir, "entry.ts"), "--outfile=./out.ts"],
        env: bunEnv,
        cwd: dir,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).exitCode,
    ).toBe(0);

    const result2 = Bun.spawnSync({
      cmd: [bunExe(), "run", "./out.ts"],
      env: bunEnv,
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(result2.exitCode).toBe(0);
  });
});

// Each case is a scenario of process-max-listeners-fixture.cjs, and what is expected is what node v26.3.0 prints for it.
// A warning is shown without "Possible EventEmitter memory leak detected." in front of it and without
// "Use emitter.setMaxListeners() to increase limit" behind it.
describe.concurrent("process max listeners", () => {
  const over = (count: number, type: string, limit: number | string = 10) =>
    `${count} ${type} listeners added to [process]. MaxListeners is ${limit}`;

  async function expectScenario(scenario: string, expected: { out?: unknown; warnings: string[] }) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(__dirname, "process-max-listeners-fixture.cjs"), scenario],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let printed: object;
    try {
      printed = JSON.parse(stdout);
    } catch {
      printed = { stdout, stderr };
    }
    expect({ ...printed, exitCode }).toEqual({ ...expected, exitCode: 0 });
  }

  it("warns once for each event that goes over the default limit", async () => {
    await expectScenario("overDefault", {
      warnings: ["SIGINT", "exit", "message", "custom", "Symbol(named)", "Symbol()", "1"].map(type => over(11, type)),
    });
  });

  it("the warning is the Error that node:events makes", async () => {
    await expectScenario("shapeOfWarning", {
      out: {
        isError: true,
        name: "MaxListenersExceededWarning",
        keys: ["name", "emitter", "type", "count"],
        emitter: true,
        type: "custom",
        count: 11,
      },
      warnings: [over(11, "custom")],
    });
  });

  it("setMaxListeners() returns process and keeps the number it was given", async () => {
    // [returned process, getMaxListeners(), _maxListeners, events.getMaxListeners(process)]
    await expectScenario("storedValues", {
      out: ["4294967296", "4294967297", "9007199254740991", "Infinity", "1.5", "0.5", "-0", "0"].map(n => [
        true,
        n,
        n,
        n,
      ]),
      warnings: [],
    });
  });

  it("setMaxListeners() refuses what node:events refuses, with the same error", async () => {
    await expectScenario("refusedValues", {
      out: {
        // [code, the error is the one that new EventEmitter().setMaxListeners() throws] for -1, NaN, -Infinity, "3", null, 1n, {}, true
        refused: [...Array(3).fill(["ERR_OUT_OF_RANGE", true]), ...Array(5).fill(["ERR_INVALID_ARG_TYPE", true])],
        missing: [
          "TypeError",
          "ERR_INVALID_ARG_TYPE",
          'The "setMaxListeners" argument must be of type number. Received undefined',
        ],
        negative: [
          "RangeError",
          "ERR_OUT_OF_RANGE",
          'The value of "setMaxListeners" is out of range. It must be >= 0. Received -1',
        ],
      },
      warnings: [],
    });
  });

  it("the limit is the own property _maxListeners, which node:events reads too", async () => {
    await expectScenario("ownProperty", {
      out: {
        descriptor: { value: "undefined", writable: true, enumerable: true, configurable: true },
        enumerated: true,
        // [getMaxListeners(), events.getMaxListeners(process), _maxListeners]
        afterSet: [5, 5, 5],
        afterStaticSet: [7, 7, 7],
        chained: 10,
      },
      warnings: [],
    });
  });

  it("follows events.defaultMaxListeners until it has a limit of its own", async () => {
    await expectScenario("liveDefault", {
      out: ["10", "20", "20", "12", "Infinity", "3", "3"],
      warnings: [over(13, "over12", 12), over(2, "over1.5", 1.5), over(4, "over3", 3)],
    });
  });

  it("the default is 10 in a program that never loads node:events", async () => {
    await expectScenario("withoutNodeEvents", { out: 10, warnings: [over(11, "x")] });
  });

  it("a limit written straight to _maxListeners counts, whatever it is", async () => {
    await expectScenario("writtenDirectly", {
      // getMaxListeners() after 3, undefined, delete (and whether the property is still there), null and "2"
      out: ["3", "10", "10", false, null, "2"],
      warnings: [
        over(4, "over3", 3),
        over(11, "overDefault"),
        over(11, "overDefaultAgain"),
        over(3, "overString", 2),
        over(3, "overBigInt", 2),
        over(3, "overObject", "two"),
      ],
    });
  });

  it("an accessor for _maxListeners runs, and what its getter throws leaves the listener in place", async () => {
    await expectScenario("accessor", {
      out: [true, 5, 5, "from the getter", 2, "from the getter", "TypeError"],
      warnings: [over(3, "over2", 2)],
    });
  });

  it("a limit that is not a whole number is compared as it is", async () => {
    await expectScenario("fractions", {
      warnings: [over(2, "over0.5", 0.5), over(2, "over1.5", 1.5), over(3, "over2.5", 2.5)],
    });
  });

  it("warns again for an event only after it was down to one listener", async () => {
    await expectScenario("oncePerList", {
      out: [11, 3],
      warnings: [over(11, "x"), over(11, "x"), over(11, "x"), over(3, "y", 2), over(3, "y", 2)],
    });
  });

  it("a limit raised after a warning does not warn again, and a limit lowered later does", async () => {
    await expectScenario("raisedAndLowered", { warnings: [over(2, "a", 1), over(4, "b", 1)] });
  });

  it("a newListener handler changes the limit before it is read", async () => {
    await expectScenario("newListenerChangesLimit", { out: 1, warnings: [over(2, "lowered", 1)] });
  });

  it("calls whatever process.emitWarning is, and keeps the listener if that throws", async () => {
    await expectScenario("replacedEmitWarning", {
      out: { handed: [[1, "MaxListenersExceededWarning", 11]], thrown: "from emitWarning", kept: 13 },
      warnings: [],
    });
  });

  it("every method that adds a listener checks the limit", async () => {
    await expectScenario("everyAddMethod", {
      warnings: [
        "on",
        "addListener",
        "once",
        "prependListener",
        "prependOnceListener",
        "sameFunction",
        "events.once",
        "error",
        "node:events",
      ].map(type => over(2, type, 1)),
    });
  });

  it("the process of a Worker has a limit and a default of its own", async () => {
    await expectScenario("worker", {
      out: { inWorker: { before: [10, true], warnings: [over(3, "inWorker", 2)] }, outside: 50 },
      warnings: [],
    });
  });

  // Not node: there process is an emitter of node:events. Here the check is native, and node:events costs a program that
  // only listens on process about a millisecond of start-up.
  it("does not evaluate node:events to check the limit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const loaded = () => typeof process._eventsCount !== "undefined";
         const seen = [loaded()];
         for (let i = 0; i < 11; i++) process.on("x", () => {});
         seen.push(loaded());
         process.setMaxListeners(20);
         seen.push(loaded(), process.getMaxListeners(), loaded());
         console.log(JSON.stringify(seen));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("11 x listeners added to [process]");
    expect(stdout.trim()).toBe(JSON.stringify([false, false, false, 20, false]));
    expect(exitCode).toBe(0);
  });
});
