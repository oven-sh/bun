// https://github.com/oven-sh/bun/issues/24256
// https://github.com/oven-sh/bun/issues/24484
//
// The globalThis event target is backed by WorkerGlobalScope on every
// Zig::GlobalObject. Adding a `message` listener there refs the event loop so
// a worker stays alive to receive messages from its parent. Outside a worker
// (main thread, ShadowRealm) there is no parent, so the listener must not
// prevent the process from exiting.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.each([
  ["globalThis.onmessage", `globalThis.onmessage = () => {};`],
  ['addEventListener("message")', `globalThis.addEventListener("message", () => {});`],
  ["ShadowRealm onmessage", `new ShadowRealm().evaluate("globalThis.onmessage = () => {}; 0");`],
])("%s on the main thread does not keep the process alive", (_, setup) => {
  test("exits", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `${setup} console.log("hello world");`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("hello world\n");
    expect(exitCode).toBe(0);
  });
});

// The inverse: inside a worker, `onmessage` on the global scope MUST keep the
// event loop alive so the worker can receive messages from its parent. The
// worker below sets onmessage to a handler that clears itself after replying;
// if the event-loop ref were not taken the worker would exit immediately and
// the message would never be delivered.
test("onmessage inside a worker keeps the worker alive", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const w = new Worker(
          \`data:text/javascript,onmessage = e => { postMessage(e.data); onmessage = null; };\`,
        );
        w.onmessage = e => { console.log("got:" + e.data); w.onmessage = null; };
        w.postMessage("hi");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("got:hi\n");
  expect(exitCode).toBe(0);
});
