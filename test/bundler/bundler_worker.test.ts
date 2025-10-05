import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("worker/BasicWorkerBundle", {
    files: {
      "/entry.js": `
        const worker = new Worker('./worker.js');
        worker.postMessage('hello from main');
        console.log('main thread started');
      `,
      "/worker.js": `
        self.onmessage = function(e) {
          console.log('Worker received:', e.data);
          self.postMessage('hello from worker');
        };
        console.log('worker thread started');
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      // Check that the main entry point was generated
      api.assertFileExists("/out/entry.js");

      // Verify the main file contains the worker constructor call
      const mainContent = api.readFile("/out/entry.js");
      api.expectFile("/out/entry.js").toContain("new Worker(");
      api.expectFile("/out/entry.js").toContain("main thread started");
    },
  });

  itBundled("worker/WorkerWithOptions", {
    files: {
      "/entry.js": `
        const worker = new Worker('./worker.js', { type: 'module' });
        worker.postMessage('hello with options');
        console.log('main thread with options');
      `,
      "/worker.js": `
        self.onmessage = function(e) {
          console.log('Worker with options received:', e.data);
        };
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      // Check that both files were generated
      api.assertFileExists("/out/entry.js");

      // Verify the main file preserves the options parameter
      api.expectFile("/out/entry.js").toContain("new Worker(");
      api.expectFile("/out/entry.js").toContain("type:");
      api.expectFile("/out/entry.js").toContain("module");
    },
  });

  itBundled("worker/NestedWorkerImports", {
    files: {
      "/entry.js": `
        import { createWorker } from './factory.js';
        const worker = createWorker();
        console.log('main with factory');
      `,
      "/factory.js": `
        export function createWorker() {
          return new Worker('./worker.js');
        }
      `,
      "/worker.js": `
        import { helper } from './helper.js';
        self.onmessage = function(e) {
          console.log('Worker:', helper(e.data));
        };
      `,
      "/helper.js": `
        export function helper(msg) {
          return 'Processed: ' + msg;
        }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      api.assertFileExists("/out/entry.js");

      // Verify factory.js is properly bundled into the main entry
      api.expectFile("/out/entry.js").toContain("createWorker");
    },
  });

  itBundled("worker/MultipleWorkers", {
    files: {
      "/entry.js": `
        const worker1 = new Worker('./worker1.js');
        const worker2 = new Worker('./worker2.js');
        console.log('main with multiple workers');
      `,
      "/worker1.js": `
        console.log('worker 1 started');
        self.onmessage = (e) => console.log('Worker 1:', e.data);
      `,
      "/worker2.js": `
        console.log('worker 2 started');
        self.onmessage = (e) => console.log('Worker 2:', e.data);
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      api.assertFileExists("/out/entry.js");

      // Verify main contains both worker constructors
      const mainContent = api.readFile("/out/entry.js");
      // Should contain two Worker constructor calls
      const workerMatches = mainContent.match(/new Worker\(/g);
      if (!workerMatches || workerMatches.length !== 2) {
        throw new Error(`Expected 2 Worker constructors, found ${workerMatches?.length || 0}`);
      }
    },
  });
});
