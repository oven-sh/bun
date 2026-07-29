// Fixture for "web Worker argv followed by worker_threads Worker does not
// crash" in worker.test.ts. The crash only reproduced under `bun test` (not
// `bun -e`), so this must be driven as a test file in a subprocess.
import { expect, test } from "bun:test";
import wt from "worker_threads";

const url = new URL("worker-fixture-argv.js", import.meta.url);

test("web Worker with argv reads process.argv/execArgv", async () => {
  const w = new Worker(url.href, { argv: ["--some-arg=1"], execArgv: ["--no-warnings"] });
  const result: any = await new Promise((resolve, reject) => {
    w.onerror = reject;
    w.onmessage = e => resolve(e.data);
    w.postMessage(1);
  });
  w.terminate();
  expect(result.argv[result.argv.length - 1]).toBe("--some-arg=1");
  expect(result.execArgv).toEqual(["--no-warnings"]);
});

test("worker_threads Worker after the above", async () => {
  const w = new wt.Worker(url, {});
  const result: any = await new Promise(resolve => {
    w.on("message", resolve);
    w.postMessage(1);
  });
  await w.terminate();
  expect(result.argv.length).toBeGreaterThan(0);
});
