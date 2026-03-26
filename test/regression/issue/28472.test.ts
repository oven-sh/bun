import { expect, test } from "bun:test";
import { tempDir } from "harness";
import inspector from "inspector";
import { Worker } from "worker_threads";

test("worker_threads inspector Profiler.stop returns profile in worker", async () => {
  using dir = tempDir("issue-28472", {
    "worker.cjs": `
const inspector = require('inspector');
const { parentPort } = require('worker_threads');

const session = new inspector.Session();
session.connect();
session.post('Profiler.enable', () => {
  session.post('Profiler.start', () => {
    let x = 0;
    for (let i = 0; i < 1e5; i++) x += i;
    session.post('Profiler.stop', (err, result) => {
      let msg;
      if (err) msg = 'error:' + err.message;
      else if (!result || !result.profile) msg = 'null_profile';
      else if (!result.profile.nodes || !result.profile.nodes.length) msg = 'empty_nodes';
      else msg = 'ok';
      session.disconnect();
      parentPort.postMessage(msg);
    });
  });
});
`,
  });

  // Start profiler on main thread
  const session = new inspector.Session();
  session.connect();

  await new Promise<void>((resolve, reject) => {
    session.post("Profiler.enable", err => {
      if (err) return reject(err);
      session.post("Profiler.start", err => {
        if (err) return reject(err);
        resolve();
      });
    });
  });

  // Run worker that also profiles
  const workerResult = await new Promise<string>((resolve, reject) => {
    const worker = new Worker(String(dir) + "/worker.cjs");
    worker.on("message", msg => {
      worker.terminate().then(() => resolve(msg));
    });
    worker.on("error", reject);
  });

  // Stop profiler on main thread
  const mainResult = await new Promise<string>(resolve => {
    session.post("Profiler.stop", (err, result) => {
      session.disconnect();
      if (err) return resolve("error:" + err.message);
      if (!result || !result.profile) return resolve("null_profile");
      if (!result.profile.nodes || !result.profile.nodes.length) return resolve("empty_nodes");
      resolve("ok");
    });
  });

  expect(workerResult).toBe("ok");
  expect(mainResult).toBe("ok");
}, 15_000);
