import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("worker_threads inspector Profiler.stop returns profile in worker", () => {
  using dir = tempDir("issue-28472", {
    "index.cjs": `
const { Worker, isMainThread, parentPort } = require('worker_threads');
const inspector = require('inspector');

if (isMainThread) {
  const session = new inspector.Session();
  session.connect();
  session.post('Profiler.enable', () => {
    session.post('Profiler.start', () => {
      const worker = new Worker(__filename);
      worker.on('message', (msg) => {
        console.log('WORKER_RESULT:' + msg);
        session.post('Profiler.stop', (err, result) => {
          if (err) { console.log('MAIN_RESULT:error:' + err.message); }
          else if (!result || !result.profile) { console.log('MAIN_RESULT:null_profile'); }
          else if (!result.profile.nodes || !result.profile.nodes.length) { console.log('MAIN_RESULT:empty_nodes'); }
          else { console.log('MAIN_RESULT:ok'); }
          session.disconnect();
          setTimeout(() => process.exit(0), 10);
        });
      });
      worker.on('error', (e) => { console.log('WORKER_RESULT:thread_error:' + e.message); process.exit(1); });
    });
  });
} else {
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
}
`,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "index.cjs"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      // Pre-existing GC timer leaks in the child cause non-zero exit under ASAN.
      ASAN_OPTIONS: "detect_leaks=0:" + (bunEnv.ASAN_OPTIONS ?? ""),
    },
    stderr: "pipe",
    timeout: 14_000,
  });

  const stdout = result.stdout.toString();

  expect(stdout).toContain("WORKER_RESULT:ok");
  expect(stdout).toContain("MAIN_RESULT:ok");
  expect(result.exitCode).toBe(0);
}, 15_000);
