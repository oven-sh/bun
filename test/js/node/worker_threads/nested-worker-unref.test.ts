import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A worker A that spawns a child worker B and then unrefs B (or constructs B
// with {ref:false}) should be able to exit naturally once its own event loop
// drains, same as when A is the main thread. Node.js behavior.
describe("nested worker ref/unref", () => {
  async function run(innerBody: string) {
    const src = /* js */ `
      const { Worker } = require("worker_threads");
      const inner = ${JSON.stringify(innerBody)};
      const w = new Worker(inner, { eval: true });
      w.on("message", m => console.log(m));
      w.on("exit", code => {
        console.log("outer-exit", code);
        process.exit(0);
      });
      w.on("error", err => {
        console.error(String(err));
        process.exit(1);
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("child.unref() lets the parent worker exit", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { Worker, parentPort } = require("worker_threads");
      const c = new Worker("setInterval(() => {}, 1e9)", { eval: true });
      c.unref();
      parentPort.postMessage("unrefed");
    `);
    expect({ stdout, stderr }).toEqual({ stdout: "unrefed\nouter-exit 0\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("{ref:false} lets the parent worker exit", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { Worker, parentPort } = require("worker_threads");
      const c = new Worker("setInterval(() => {}, 1e9)", { eval: true, ref: false });
      parentPort.postMessage("spawned");
    `);
    expect({ stdout, stderr }).toEqual({ stdout: "spawned\nouter-exit 0\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("refed nested worker still keeps the parent worker alive", async () => {
    // Negative contract: without unref, the child must keep the parent alive
    // long enough to deliver its message.
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const { Worker, parentPort } = require("worker_threads");
      const c = new Worker(
        "const { parentPort } = require('worker_threads'); setImmediate(() => parentPort.postMessage('hi'));",
        { eval: true },
      );
      c.on("message", m => {
        parentPort.postMessage("got:" + m);
        c.terminate();
      });
    `);
    expect({ stdout, stderr }).toEqual({ stdout: "got:hi\nouter-exit 0\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});
