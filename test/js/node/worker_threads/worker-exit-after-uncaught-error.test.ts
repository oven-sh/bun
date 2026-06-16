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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const line = stdout.trim();
  let parsed: { msgs: string[]; code: number };
  try {
    parsed = JSON.parse(line);
  } catch {
    parsed = { msgs: [], code: -1 };
  }
  // The exit handler's postMessage must reach the parent; message ordering
  // relative to the error event is not guaranteed across threads, so sort.
  // stderr carries the worker's uncaught-error trace and is expected to be
  // non-empty; it is surfaced here so a failure diff is self-diagnosing.
  expect({ msgs: parsed.msgs.toSorted(), code: parsed.code, exitCode, stderr }).toEqual({
    msgs: ["error:boom", "exit:1", "ready"],
    code: 1,
    exitCode: 0,
    stderr: expect.any(String),
  });
});
