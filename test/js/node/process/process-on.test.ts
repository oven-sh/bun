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
// No scenario puts an event over its limit: process does not warn of that yet, and node does.
describe.concurrent("process max listeners", () => {
  async function expectScenario(scenario: string[], expected: unknown) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(__dirname, "process-max-listeners-fixture.cjs"), ...scenario],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let printed: unknown;
    try {
      printed = JSON.parse(stdout);
    } catch {
      printed = { stdout, stderr };
    }
    expect({ printed, exitCode }).toEqual({ printed: expected, exitCode: 0 });
  }

  it("setMaxListeners() returns process and keeps the number it was given", async () => {
    // [returned process, getMaxListeners(), _maxListeners, events.getMaxListeners(process), getMaxListeners() is the number]
    await expectScenario(
      ["storedValues"],
      ["4294967296", "4294967297", "9007199254740991", "Infinity", "1.5", "0.5", "-0", "0"].map(n => [
        true,
        n,
        n,
        n,
        true,
      ]),
    );
  });

  it("setMaxListeners() refuses what node:events refuses, with the same error", async () => {
    await expectScenario(["refusedValues"], {
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
      kept: 4,
    });
  });

  it("the limit is the own property _maxListeners, which node:events reads too", async () => {
    await expectScenario(["ownProperty"], {
      descriptor: { value: "undefined", writable: true, enumerable: true, configurable: true },
      enumerated: true,
      // [getMaxListeners(), events.getMaxListeners(process), _maxListeners]
      afterSet: [5, 5, 5],
      afterStaticSet: [7, 7, 7],
    });
  });

  it("a call can be chained after setMaxListeners()", async () => {
    // [.on() after it returned process, the listener was added, getMaxListeners()]
    await expectScenario(["chained"], [true, true, 20]);
  });

  it("follows events.defaultMaxListeners until it has a limit of its own", async () => {
    // [getMaxListeners(), events.getMaxListeners(process)] at the start, then with a default of 20, 12, Infinity and 1.5,
    // after a default of -1 was refused, with a limit of 3 beside a default of 50, and with the limit undefined again
    await expectScenario(
      ["liveDefault"],
      [
        ["10", "10"],
        ["20", "20"],
        ["12", "12"],
        ["Infinity", "Infinity"],
        ["1.5", "1.5"],
        "ERR_OUT_OF_RANGE",
        ["1.5", "1.5"],
        ["3", "3"],
        ["50", "50"],
      ],
    );
  });

  it("getMaxListeners() answers what was written straight to _maxListeners, whatever it is", async () => {
    // after 3, undefined, null, "2", -5, 2n, "text" and NaN; then an object comes back as it is, and a deleted limit is the default
    await expectScenario(["writtenDirectly"], ["3", "10", null, "2", "-5", "2n", "text", "NaN", true, "10", false]);
  });

  it("an accessor for _maxListeners runs, and a limit that cannot be written throws", async () => {
    // [getter, setMaxListeners(4) returned process, what the setter stored, getter again, what a throwing getter threw,
    //  setMaxListeners() on a read-only limit, that limit]
    await expectScenario(["accessor"], [2, true, 5, 5, "from the getter", "TypeError", 1]);
  });

  it("the process of a Worker has a limit and a default of its own", async () => {
    await expectScenario(["worker"], {
      // [the default, _maxListeners is an own property, with a default of 7, setMaxListeners(2) returned process, getMaxListeners()]
      inWorker: [10, true, 7, true, 2],
      // Outside the default is 50: [getMaxListeners(), _maxListeners is undefined]
      outside: [50, true],
    });
  });

  it.each([
    "undefined",
    "null",
    "a number",
    "a string",
    "an object",
    "a frozen object",
    "a Proxy of process",
    "deleted",
    "frozen",
    "not extensible",
  ])("events.defaultMaxListeners reaches process when the global `process` is %s", async how => {
    // For `defaultMaxListeners = 5` and then `setMaxListeners(6)`: [what it threw, the default, getMaxListeners() of the
    // real process, events.getMaxListeners() of it]
    await expectScenario(["replacedGlobal", how, "loaded"], [null, 5, 5, 5, null, 6, 6, 6]);
  });

  it.each(["undefined", "an object", "a Proxy of process", "deleted"])(
    "events.defaultMaxListeners reaches process when the global `process` is %s before node:events is loaded",
    async how => {
      await expectScenario(["replacedGlobal", how, "replaced"], [null, 5, 5, 5, null, 6, 6, 6]);
    },
  );

  it("a call through a variable has no `this`: it throws and stores nothing", async () => {
    await expectScenario(["bareCall"], {
      // [getMaxListeners(), setMaxListeners(2)] through a local and through a global
      captured: ["TypeError", "TypeError"],
      byGlobalName: ["TypeError", "TypeError"],
      // [a variable of the caller named _maxListeners, typeof globalThis._maxListeners, process._maxListeners]
      stored: ["a variable of the caller", "undefined", "undefined"],
    });
  });

  it("setMaxListeners() refuses a count before it reads or writes its receiver", async () => {
    await expectScenario(["refusedBeforeReceiver"], {
      // receivers undefined, null, 5, a frozen object (twice), an accessor and a Proxy, then three calls through a variable
      refused: [
        "ERR_INVALID_ARG_TYPE",
        "ERR_OUT_OF_RANGE",
        "ERR_OUT_OF_RANGE",
        "ERR_OUT_OF_RANGE",
        "ERR_INVALID_ARG_TYPE",
        "ERR_INVALID_ARG_TYPE",
        "ERR_INVALID_ARG_TYPE",
        "ERR_INVALID_ARG_TYPE",
        "ERR_INVALID_ARG_TYPE",
        "ERR_OUT_OF_RANGE",
      ],
      // which accessors and traps of the receivers ran
      ranForRefused: "",
      accepted: "from the setter",
      ranForAccepted: "set",
      extraArguments: true,
    });
  });

  // Not node, where process is an emitter of node:events: here the two functions are native and do not load the module.
  it("does not evaluate node:events to set or get the limit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const loaded = () => typeof process._eventsCount !== "undefined";
         const seen = [loaded(), process.getMaxListeners(), process.setMaxListeners(20) === process, loaded()];
         seen.push(process.getMaxListeners(), loaded());
         console.log(JSON.stringify(seen));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify([false, 10, true, false, 20, false]),
      stderr: "",
      exitCode: 0,
    });
  });
});
