import { test } from "node:test";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";

test("worker terminate while setting up thread", async () => {
  // this test is inherently somewhat flaky: if we call terminate() before the worker starts
  // running any JavaScript the code will be 0 like we expect, but if we terminate while it is
  // running code the exit code is 1 instead (this happens in Node.js too). this means we can
  // randomly see an exit code of 1 if the main thread happens to run slower than usual and allows
  // the worker to run some code.
  //
  // to prevent it from polluting the flaky test list, we try 10 times and expect:
  // - at least 1 time the exit code was 0
  // - the exit code is never something other than 0 or 1
  const codes = [];
  for (let i = 0; i < 10; i++) {
    const worker = new Worker(fileURLToPath(new URL("./worker-fixture-hang.js", import.meta.url).href));
    worker.on("error", err => {
      throw err; // fail the test if there's an error
    });
    const code = await worker.terminate();
    if (code !== 0 && code !== 1) {
      throw new Error(`unexpected exit code ${code}`);
    }
    codes.push(code);
  }
  if (!codes.includes(0)) {
    throw new Error(`Expected at least one exit code to be 0, got: ${codes}`);
  }
  console.log(`Exit codes: ${codes}`);
});
