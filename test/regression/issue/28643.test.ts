import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("worker.unref() does not prevent receiving pending messages", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { Worker } = require('worker_threads');

const w = new Worker(\`
  const { parentPort } = require('worker_threads');
  parentPort.on('message', () => {
    const sharedArrayBuffer = new SharedArrayBuffer(12);
    parentPort.postMessage(sharedArrayBuffer);
  });
\`, { eval: true });

w.unref();

w.once('message', () => {
  console.log('done');
});

w.postMessage('go');
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("done\n");
  expect(exitCode).toBe(0);
});

test("worker.unref() with string message roundtrip", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { Worker } = require('worker_threads');

const w = new Worker(\`
  const { parentPort } = require('worker_threads');
  parentPort.on('message', (msg) => {
    parentPort.postMessage('reply: ' + msg);
  });
\`, { eval: true });

w.unref();

w.once('message', (msg) => {
  console.log(msg);
});

w.postMessage('hello');
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("reply: hello\n");
  expect(exitCode).toBe(0);
});

test("worker.unref() does not hang when worker fails to start", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { Worker } = require('worker_threads');

const w = new Worker('./nonexistent_file_' + Date.now() + '.js');
w.on('error', () => {
  console.log('error');
});
w.unref();
w.postMessage('go');
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("error\n");
  expect(exitCode).toBe(0);
});

test("worker.unref() allows exit when no messages are pending", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { Worker } = require('worker_threads');

const w = new Worker(\`
  setInterval(() => {}, 1000);
\`, { eval: true });

w.unref();
console.log('exited');
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("exited\n");
  expect(exitCode).toBe(0);
});
