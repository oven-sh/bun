// Also runs in Node.js (`node --test <file>`), so it uses node:test and imports only Node modules.
import assert from "node:assert";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

// Node runs the worker's bootstrap, posts 'online', then runs the entry:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/main/worker_thread.js#L148
// The bootstrap reads NODE_CHANNEL_FD (#L72). If it is set, the worker gets a process.send() that
// throws. With a shared env, an 'online' listener can set that variable, and by then it is too late
// to change the worker. The variable belongs to the whole process, so a child process runs this.
test("the worker's bootstrap is over when 'online' is emitted", async () => {
  const script = `
    const { Worker, SHARE_ENV } = require("node:worker_threads");
    const seen = [];
    const worker = new Worker('require("node:worker_threads").parentPort.postMessage(typeof process.send);', {
      eval: true,
      env: SHARE_ENV,
    });
    worker.on("online", () => {
      process.env.NODE_CHANNEL_FD = "3";
      seen.push("online");
    });
    worker.on("message", send => seen.push("process.send is " + send));
    worker.on("exit", code => console.log(seen.concat("exit " + code).join(", ")));
  `;
  // Without BUN_DEBUG_QUIET_LOGS a debug build of Bun writes its logs to stdout.
  const { NODE_CHANNEL_FD: _, ...env } = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", script], { env });
  assert.strictEqual(stdout, "online, process.send is undefined, exit 0\n");
});
