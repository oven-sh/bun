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

describe.concurrent("process MaxListenersExceededWarning", () => {
  async function run(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("warns once per event type when more than maxListeners are added", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const warned = [];
      process.on("warning", w => {
        warned.push({ name: w.name, message: w.message, type: w.type, count: w.count, emitter: w.emitter === process });
      });
      const sym = Symbol("sym");
      for (const ev of ["SIGINT", "exit", "custom", sym]) {
        for (let i = 0; i < 12; i++) process.on(ev, () => {});
      }
      process.nextTick(() => {
        console.log(JSON.stringify(warned.map(w => ({ ...w, type: String(w.type) }))));
      });
    `);
    expect(stderr).toContain("MaxListenersExceededWarning");
    expect(JSON.parse(stdout)).toEqual(
      ["SIGINT", "exit", "custom", "Symbol(sym)"].map(type => ({
        name: "MaxListenersExceededWarning",
        message: `Possible EventEmitter memory leak detected. 11 ${type} listeners added to [process]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit`,
        type,
        count: 11,
        emitter: true,
      })),
    );
    expect(exitCode).toBe(0);
  });

  it("respects process.setMaxListeners", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const warned = [];
      process.on("warning", w => warned.push(w.count + ":" + w.message.match(/MaxListeners is (\\d+)/)[1]));
      process.setMaxListeners(0);
      for (let i = 0; i < 20; i++) process.on("a", () => {});
      process.setMaxListeners(3);
      for (let i = 0; i < 5; i++) process.on("b", () => {});
      process.nextTick(() => console.log(JSON.stringify(warned)));
    `);
    expect(stderr).toContain("MaxListeners is 3");
    expect(JSON.parse(stdout)).toEqual(["4:3"]);
    expect(exitCode).toBe(0);
  });

  it("follows events.defaultMaxListeners until process.setMaxListeners is called", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const events = require("node:events");
      const warned = [];
      process.on("warning", w => warned.push(w.message.match(/(\\d+) (\\w+) listeners.*MaxListeners is (\\d+)/).slice(1).join(":")));
      events.defaultMaxListeners = 20;
      console.log(process.getMaxListeners(), events.getMaxListeners(process));
      for (let i = 0; i < 15; i++) process.on("a", () => {});
      events.setMaxListeners(12);
      for (let i = 0; i < 13; i++) process.on("b", () => {});
      events.defaultMaxListeners = Infinity;
      for (let i = 0; i < 50; i++) process.on("c", () => {});
      process.setMaxListeners(3);
      console.log(process.getMaxListeners());
      for (let i = 0; i < 4; i++) process.on("d", () => {});
      process.nextTick(() => console.log(JSON.stringify(warned)));
    `);
    expect(stderr).not.toContain("15 a listeners");
    expect(stdout).toBe(`20 20\n3\n${JSON.stringify(["13:b:12", "4:d:3"])}\n`);
    expect(exitCode).toBe(0);
  });

  it("warns again after the listeners are removed", async () => {
    const { stdout, exitCode } = await run(`
      let warned = 0;
      process.on("warning", () => warned++);
      const fns = [];
      for (let i = 0; i < 11; i++) { const fn = () => {}; fns.push(fn); process.on("x", fn); }
      // One warning per overflow, not per listener.
      process.on("x", () => {});
      for (const fn of fns) process.removeListener("x", fn);
      process.removeAllListeners("x");
      for (let i = 0; i < 11; i++) process.on("x", () => {});
      process.nextTick(() => console.log(warned));
    `);
    expect(stdout).toBe("2\n");
    expect(exitCode).toBe(0);
  });
});
