import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("new Worker publishes { worker } on the 'worker_threads' diagnostics channel", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const dc = require("node:diagnostics_channel");
       const { Worker } = require("node:worker_threads");
       const events = [];
       let captured;
       dc.subscribe("worker_threads", (m, name) => {
         captured = m?.worker;
         events.push({ name, isWorker: m?.worker instanceof Worker });
       });
       // Node publishes synchronously inside the constructor, before it returns.
       const w = new Worker("0", { eval: true });
       console.log(JSON.stringify({ firedSync: events.length, events, sameInstance: captured === w }));
       w.terminate();`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual({
    firedSync: 1,
    events: [{ name: "worker_threads", isWorker: true }],
    sameInstance: true,
  });
  expect(exitCode).toBe(0);
});

test("the 'worker_threads' diagnostics channel is not published when Worker construction throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const dc = require("node:diagnostics_channel");
       const { Worker } = require("node:worker_threads");
       let fired = 0;
       dc.subscribe("worker_threads", () => fired++);
       let threw = false;
       try { new Worker(123, { eval: true }); } catch { threw = true; }
       console.log(JSON.stringify({ threw, fired }));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual({ threw: true, fired: 0 });
  expect(exitCode).toBe(0);
});
