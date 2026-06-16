import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("process.on('exit') runs in worker after an uncaught error in a timer", async () => {
  // An uncaught error thrown from a timer callback (not top-level) should
  // still let the worker's process.on('exit') handlers run before the
  // worker exits, and those handlers can postMessage to the parent.
  const src = /* js */ `
    const { Worker } = require("node:worker_threads");
    const w = new Worker(
      \`
        const { parentPort } = require("node:worker_threads");
        process.on("exit", code => parentPort.postMessage("exit:" + code));
        parentPort.postMessage("ready");
        setTimeout(() => { throw new Error("boom"); }, 1);
        setInterval(() => {}, 1e6);
      \`,
      { eval: true },
    );
    const msgs = [];
    w.on("message", m => msgs.push(m));
    w.on("error", e => msgs.push("error:" + e.message));
    w.on("exit", code => {
      console.log(JSON.stringify({ msgs, code }));
      process.exit(0);
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const line = stdout.trim();
  expect(line).not.toBe("");
  const { msgs, code } = JSON.parse(line) as { msgs: string[]; code: number };
  // The exit handler's postMessage must reach the parent; message ordering
  // relative to the error event is not guaranteed across threads, so sort.
  expect(msgs.toSorted()).toEqual(["error:boom", "exit:1", "ready"]);
  expect(code).toBe(1);
  expect(exitCode).toBe(0);
});
