import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("FinalizationRegistry callback that throws is reported as uncaughtException", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let caught = null;
        process.on("uncaughtException", (err) => {
          caught = err;
        });
        const registry = new FinalizationRegistry(() => {
          throw new Error("boom");
        });
        for (let i = 0; i < 1000; i++) {
          registry.register({}, i);
        }
        (async () => {
          for (let i = 0; i < 20; i++) {
            Bun.gc(true);
            await new Promise(r => setImmediate(r));
            if (caught) break;
          }
          console.log(JSON.stringify({ caught: caught?.message ?? null }));
        })();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ caught: "boom" });
  expect(exitCode).toBe(0);
});

test.concurrent(
  "FinalizationRegistry callback that throws does not crash when triggered by generateHeapSnapshot",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          let caught = null;
          process.on("uncaughtException", (err) => {
            caught = err;
          });
          const registry = new FinalizationRegistry(() => {
            ArrayBuffer();
          });
          for (let i = 0; i < 1000; i++) {
            registry.register({}, i);
          }
          (async () => {
            for (let i = 0; i < 20 && !caught; i++) {
              Bun.gc(true);
              Bun.generateHeapSnapshot();
              Bun.gc(true);
              await new Promise(r => setImmediate(r));
            }
            console.log(JSON.stringify({ caught: caught?.message ?? null }));
          })();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim()).caught).toContain("ArrayBuffer");
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "FinalizationRegistry callback that throws inside a node:vm context is reported as uncaughtException",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const vm = require("node:vm");
          let caught = null;
          process.on("uncaughtException", (err) => {
            caught = err;
          });
          const ctx = vm.createContext({});
          vm.runInContext(\`
            globalThis.r = new FinalizationRegistry(() => { throw new Error("boom-in-vm"); });
            for (let i = 0; i < 1000; i++) globalThis.r.register({}, i);
          \`, ctx);
          (async () => {
            for (let i = 0; i < 20; i++) {
              Bun.gc(true);
              await new Promise(r => setImmediate(r));
              if (caught) break;
            }
            console.log(JSON.stringify({ caught: caught?.message ?? null }));
          })();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ caught: "boom-in-vm" });
    expect(exitCode).toBe(0);
  },
);
