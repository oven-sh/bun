import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent.each([
  {
    name: "does not prevent receiving pending messages",
    script: `
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
    expected: "done\n",
    expectedStderr: "",
  },
  {
    name: "with string message roundtrip",
    script: `
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
    expected: "reply: hello\n",
    expectedStderr: "",
  },
  {
    name: "does not hang when worker fails to start",
    script: `
const { Worker } = require('worker_threads');

const w = new Worker('./nonexistent_file_' + Date.now() + '.js');
w.on('error', () => {
  console.log('error');
});
w.unref();
w.postMessage('go');
`,
    expected: "error\n",
    expectedStderr: "",
  },
  {
    name: "allows exit when no messages are pending",
    script: `
const { Worker } = require('worker_threads');

const w = new Worker(\`
  setInterval(() => {}, 1000);
\`, { eval: true });

w.unref();
console.log('exited');
`,
    expected: "exited\n",
    expectedStderr: "",
  },
])("worker.unref() $name", async ({ script, expected, expectedStderr }) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe(expectedStderr);
  expect(stdout).toBe(expected);
  expect(exitCode).toBe(0);
});
