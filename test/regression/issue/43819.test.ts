import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/43819
// Regression in 1.4.0: the `.resolves` flavour of #37189. A Worker echo
// awaited plainly settles at once. The same echo under
// `expect(p).resolves` was never observed: the reply arrived while the
// matcher spun a nested event-loop wait from inside the previous message's
// drain, and the drain posted no wakeup for it.

// Web Worker: EventTarget. worker_threads Worker: EventEmitter. No deadline
// inside the fixture: worker boot alone can take seconds under a debug ASAN
// build, and the spawn timeout already bounds a hung child.
const echoSource = (listen: string, unlisten: string, data: string) => `function echo(target, value) {
  return new Promise(resolve => {
    const onMessage = ${data} => {
      target.${unlisten}("message", onMessage);
      resolve(data);
    };
    target.${listen}("message", onMessage);
    target.postMessage(value);
  });
}`;

const webWorkerMain = `import { expect } from "bun:test";
${echoSource("addEventListener", "removeEventListener", "({ data })")}
const worker = new Worker(new URL("./echo-worker.js", import.meta.url).href);
await echo(worker, "warmup");
await expect(echo(worker, "payload")).resolves.toBe("payload");
worker.terminate();
console.log("OK");`;

const nodeWorkerMain = `import { expect } from "bun:test";
import { Worker } from "node:worker_threads";
${echoSource("on", "off", "data")}
const worker = new Worker(new URL("./echo-worker.js", import.meta.url));
await echo(worker, "warmup");
await expect(echo(worker, "payload")).resolves.toBe("payload");
await worker.terminate();
console.log("OK");`;

async function expectExitsCleanly(proc: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "OK\n", stderr: "", exitCode: 0 });
}

test.concurrent("expect().resolves observes a Worker echo that arrives during a nested wait", async () => {
  using dir = tempDir("issue-43819-web-worker", {
    "echo-worker.js": `self.onmessage = event => {
      postMessage(event.data);
    };`,
    "main.js": webWorkerMain,
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
});

test.concurrent("expect().resolves observes a worker_threads echo that arrives during a nested wait", async () => {
  using dir = tempDir("issue-43819-node-worker", {
    "echo-worker.js": `import { parentPort } from "node:worker_threads";
    parentPort.on("message", value => {
      parentPort.postMessage(value);
    });`,
    "main.js": nodeWorkerMain,
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
});
