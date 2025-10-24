import { devTest, emptyHtmlFile } from "../bake-harness";

// Note: Dev server worker bundling is not yet functional. While the infrastructure
// exists (IncrementalGraph detects workers, printer outputs paths, tryServeWorker exists),
// the parser transformation doesn't run in dev mode OR workers aren't registered before
// serving. Needs investigation into why worker detection doesn't trigger during dev bundling.
// Production bundling works (see test/bundler/bundler_worker.test.ts - 4 tests passing).

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
