import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/22471
// Segfault in MessagePort.postMessage when ScriptExecutionContext is destroyed
// during high-frequency message passing between workers.
test("MessagePort.postMessage does not crash after worker termination", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { Worker, MessageChannel } = require("worker_threads");

const workers = [];
const ports = [];

for (let i = 0; i < 10; i++) {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(
    'const { parentPort } = require("worker_threads");' +
    'parentPort.on("message", ({ port }) => {' +
    '  if (port) {' +
    '    port.on("message", () => {});' +
    '    for (let j = 0; j < 50; j++) try { port.postMessage({ j }); } catch(e) {}' +
    '  }' +
    '});',
    { eval: true }
  );

  worker.postMessage({ port: port2 }, [port2]);
  workers.push(worker);
  ports.push(port1);

  for (let j = 0; j < 50; j++) {
    try { port1.postMessage({ j }); } catch(e) {}
  }
}

// Terminate all workers without awaiting
for (const w of workers) w.terminate();

// Post messages after termination has been initiated
for (const p of ports) {
  try { p.postMessage({ afterTerminate: true }); } catch(e) {}
  p.close();
}

console.log("SUCCESS");
setTimeout(() => process.exit(0), 500);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("SUCCESS");
  expect(exitCode).toBe(0);
});
