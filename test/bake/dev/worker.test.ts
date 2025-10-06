import { devTest, emptyHtmlFile } from "../bake-harness";

// Note: Worker polyfill has been added to the test harness (client-fixture.mjs)
// using Node.js worker_threads. However, dev server support for worker bundling
// is not yet complete - workers need to be discovered and registered in the
// IncrementalGraph. This test is a placeholder for when that work is done.

devTest.skip = ["linux", "darwin", "win32"] as any;

devTest("worker can be instantiated with string path", {
  skip: ["linux", "darwin", "win32"],
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      const worker = new Worker('./worker.ts');
      worker.postMessage('ping');
      worker.onmessage = (e) => {
        console.log('RESPONSE_FROM_WORKER:' + e.data);
      };
      console.log('MAIN_LOADED');
    `,
    "worker.ts": `
      self.onmessage = (e) => {
        console.log('WORKER_RECEIVED:' + e.data);
        self.postMessage('pong');
      };
      console.log('WORKER_STARTED');
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");

    // Main thread loads first
    await c.expectMessage("MAIN_LOADED");

    // Worker starts
    await c.expectMessage("WORKER_STARTED");

    // Worker receives message from main
    await c.expectMessage("WORKER_RECEIVED:ping");

    // Main receives response from worker
    await c.expectMessage("RESPONSE_FROM_WORKER:pong");
  },
});
