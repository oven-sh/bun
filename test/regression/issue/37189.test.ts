import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/37189
// Regression in 1.3.14: a Worker/MessagePort message arriving while the
// receiver was parked in a nested event-loop wait (expect().rejects) reached
// from a previous message's continuation was enqueued without posting a
// wakeup, deadlocking the process. The first awaited call below makes the
// second call's assertion run as a continuation of the message dispatch,
// with the drain loop still on the native stack.

const channelMain = `import { expect } from "bun:test";
const { port1, port2 } = new MessageChannel();
port2.onmessage = e => {
  port2.postMessage({ type: "reply", id: e.data.id, error: "boom" });
};
const pending = new Map();
port1.onmessage = e => {
  const msg = e.data;
  if (msg.type !== "reply") return;
  const reject = pending.get(msg.id);
  pending.delete(msg.id);
  reject?.(new Error(msg.error));
};
let seq = 0;
const call = () => new Promise((_resolve, reject) => {
  const id = ++seq;
  pending.set(id, reject);
  port1.postMessage({ id });
});

await call().catch(() => {});
await expect(call()).rejects.toThrow("boom");
port1.close();
port2.close();
console.log("OK");`;

const workerMain = `import { expect } from "bun:test";
const worker = new Worker(new URL("./worker.js", import.meta.url).href);
const pending = new Map();
worker.onmessage = e => {
  const msg = e.data;
  if (msg.type !== "reply") return;
  const reject = pending.get(msg.id);
  pending.delete(msg.id);
  reject?.(new Error(msg.error));
};
let seq = 0;
const call = () => new Promise((_resolve, reject) => {
  const id = ++seq;
  pending.set(id, reject);
  worker.postMessage({ id });
});

await call().catch(() => {});
await expect(call()).rejects.toThrow("boom");
worker.terminate();
console.log("OK");`;

// Two requests in flight at once: both replies are queued before the
// receiver's drain runs, so the second is already taken for dispatch when
// the first's handler resumes the continuation that waits for it. No send()
// runs during that wait, so the drain itself has to keep a wakeup posted.
const pipelinedChannelMain = `import { expect } from "bun:test";
const { port1, port2 } = new MessageChannel();
port2.onmessage = e => {
  port2.postMessage({ id: e.data.id });
};
const pending = new Map();
port1.onmessage = e => {
  const resolve = pending.get(e.data.id);
  pending.delete(e.data.id);
  resolve?.(e.data.id);
};
let seq = 0;
const call = () => new Promise(resolve => {
  const id = ++seq;
  pending.set(id, resolve);
  port1.postMessage({ id });
});

const first = call();
const second = call();
await first;
await expect(second).resolves.toBe(2);
port1.close();
port2.close();
console.log("OK");`;

const pipelinedWorkerMain = `import { expect } from "bun:test";
const worker = new Worker(new URL("./worker.js", import.meta.url).href);
const pending = new Map();
worker.onmessage = e => {
  const resolve = pending.get(e.data.id);
  pending.delete(e.data.id);
  resolve?.(e.data.id);
};
let seq = 0;
const call = () => new Promise(resolve => {
  const id = ++seq;
  pending.set(id, resolve);
  worker.postMessage({ id });
});

const first = call();
const second = call();
await first;
await expect(second).resolves.toBe(2);
worker.terminate();
console.log("OK");`;

async function expectExitsCleanly(proc: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "OK\n", stderr: "", exitCode: 0 });
}

test.concurrent(
  "expect().rejects settles when the rejection arrives from a Worker message during a nested wait",
  async () => {
    using dir = tempDir("issue-37189-worker", {
      "worker.js": `self.onmessage = e => {
      self.postMessage({ type: "reply", id: e.data.id, error: "boom" });
    };`,
      "main.js": workerMain,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
    await expectExitsCleanly(proc);
  },
);

test.concurrent(
  "expect().rejects settles when the rejection arrives from a MessageChannel message during a nested wait",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", channelMain],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
    await expectExitsCleanly(proc);
  },
);

test.concurrent(
  "expect().resolves settles when the MessageChannel reply was already queued before the nested wait",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", pipelinedChannelMain],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
    await expectExitsCleanly(proc);
  },
);

test.concurrent(
  "expect().resolves settles when the Worker reply was already queued before the nested wait",
  async () => {
    using dir = tempDir("issue-37189-worker-pipelined", {
      // Reply to both requests in one burst so both replies are usually
      // queued before the parent's drain runs.
      "worker.js": `const ids = [];
    self.onmessage = e => {
      ids.push(e.data.id);
      if (ids.length === 2) for (const id of ids.splice(0)) self.postMessage({ id });
    };`,
      "main.js": pipelinedWorkerMain,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
    await expectExitsCleanly(proc);
  },
);
