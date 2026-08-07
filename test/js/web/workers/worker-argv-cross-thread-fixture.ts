// Fixture for "web Worker argv followed by worker_threads Worker does not
// crash" in worker.test.ts. The crash only reproduced under `bun test` (not
// `bun -e`), so this must be driven as a test file in a subprocess.
import { expect, test } from "bun:test";
import wt from "worker_threads";

const url = new URL("worker-fixture-argv.js", import.meta.url);

test("web Worker with argv reads process.argv/execArgv", async () => {
  const w = new Worker(url.href, { argv: ["--some-arg=1"], execArgv: ["--no-warnings"] });
  try {
    const result: any = await new Promise((resolve, reject) => {
      w.onerror = reject;
      w.onmessage = e => resolve(e.data);
      w.postMessage(1);
    });
    expect(result.argv[result.argv.length - 1]).toBe("--some-arg=1");
    expect(result.execArgv).toEqual(["--no-warnings"]);
  } finally {
    // Web Worker.terminate() is synchronous (returns void); the crash this
    // fixture reproduces requires the next test to start before this worker
    // is GC'd, so don't insert any additional awaits here.
    w.terminate();
  }
});

test("worker_threads Worker after the above", async () => {
  const w = new wt.Worker(url, {});
  try {
    const result: any = await new Promise((resolve, reject) => {
      w.once("message", resolve);
      w.once("error", reject);
      w.once("exit", code => reject(new Error(`worker exited before replying (code ${code})`)));
      w.postMessage(1);
    });
    expect(result.argv.length).toBeGreaterThan(0);
  } finally {
    await w.terminate();
  }
});
