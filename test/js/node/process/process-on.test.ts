import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
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
    const dir = tempDirWithFiles("process-on-test", {
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
    const dir = tempDirWithFiles("process-on-test", {
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

describe.concurrent("process.on('unhandledRejection')", () => {
  it("keeps the process alive for work the handler schedules after a microtask hop", async () => {
    // The handler only reaches setTimeout after one nextTick/microtask hop, which
    // is what `await` compiles to. That checkpoint has to drain before the loop
    // decides it has no work left, or the timers never run.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          process.on("unhandledRejection", reason => {
            if (reason === "a") Promise.resolve().then(() => setTimeout(() => console.log("then"), 1));
            if (reason === "b") queueMicrotask(() => setTimeout(() => console.log("queueMicrotask"), 1));
            if (reason === "c") process.nextTick(() => setTimeout(() => console.log("nextTick"), 1));
          });
          Promise.reject("a");
          Promise.reject("b");
          Promise.reject("c");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // nextTick drains before the microtask queue, so its timer is armed first.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "nextTick\nthen\nqueueMicrotask",
      stderr: "",
      exitCode: 0,
    });
  });

  it("runs before beforeExit when the rejection comes from a timer", async () => {
    // The rejection lands in the timer phase, after the last thing keeping the
    // loop alive is gone. Node notifies it inside that phase, so the handler
    // still gets to schedule work and `beforeExit` observes the real state.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const log = [];
          process.on("beforeExit", () => {
            log.push("beforeExit");
            console.log(log.join(","));
          });
          process.on("unhandledRejection", () => {
            log.push("handler");
            Promise.resolve().then(() => setTimeout(() => log.push("recovered"), 1));
          });
          setTimeout(() => {
            Promise.reject(new Error("late"));
          }, 1);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "handler,recovered,beforeExit",
      stderr: "",
      exitCode: 0,
    });
  });

  it("runs for a rejection raised by a beforeExit listener", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          let n = 0;
          process.on("beforeExit", () => {
            console.log("beforeExit#" + ++n);
            if (n === 1) Promise.reject(new Error("from beforeExit"));
          });
          process.on("unhandledRejection", () => {
            console.log("handler");
            Promise.resolve().then(() => setTimeout(() => console.log("recovered"), 1));
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "beforeExit#1\nhandler\nrecovered\nbeforeExit#2",
      stderr: "",
      exitCode: 0,
    });
  });
});
