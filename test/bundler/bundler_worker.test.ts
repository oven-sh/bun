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
      api.expectFile("/out/entry.js").toBeFile();
      
      // Check that a separate worker entry point was generated
      const outputFiles = api.readDir("/out");
      const workerFile = outputFiles.find(file => file.includes("worker") && file.endsWith(".js"));
      api.expect(workerFile, "Expected a separate worker bundle to be generated").toBeTruthy();
      
      // Verify the main file contains the worker constructor call
      const mainContent = api.readFile("/out/entry.js");
      api.expect(mainContent).toContain("new Worker(");
      
      if (workerFile) {
        // Verify the worker file contains the worker code
        const workerContent = api.readFile(`/out/${workerFile}`);
        api.expect(workerContent).toContain("self.onmessage");
        api.expect(workerContent).toContain("worker thread started");
      }
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
      api.expectFile("/out/entry.js").toBeFile();
      
      const outputFiles = api.readDir("/out");
      const workerFile = outputFiles.find(file => file.includes("worker") && file.endsWith(".js"));
      api.expect(workerFile, "Expected a separate worker bundle to be generated").toBeTruthy();
      
      // Verify the main file preserves the options parameter
      const mainContent = api.readFile("/out/entry.js");
      api.expect(mainContent).toContain("new Worker(");
      api.expect(mainContent).toContain("type:");
      api.expect(mainContent).toContain("module");
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
      api.expectFile("/out/entry.js").toBeFile();
      
      const outputFiles = api.readDir("/out");
      const workerFile = outputFiles.find(file => file.includes("worker") && file.endsWith(".js"));
      api.expect(workerFile, "Expected a separate worker bundle to be generated").toBeTruthy();
      
      // Verify factory.js is properly bundled into the main entry
      const mainContent = api.readFile("/out/entry.js");
      api.expect(mainContent).toContain("createWorker");
      
      if (workerFile) {
        // Verify helper.js is properly bundled into the worker
        const workerContent = api.readFile(`/out/${workerFile}`);
        api.expect(workerContent).toContain("helper");
        api.expect(workerContent).toContain("Processed:");
      }
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
      api.expectFile("/out/entry.js").toBeFile();
      
      const outputFiles = api.readDir("/out");
      const jsFiles = outputFiles.filter(file => file.endsWith(".js"));
      
      // Should have main entry + 2 worker bundles = at least 3 JS files
      api.expect(jsFiles.length).toBeGreaterThanOrEqual(3);
      
      // Check that worker files were generated (may have hashes in names)
      const workerFiles = jsFiles.filter(file => file !== "entry.js");
      api.expect(workerFiles.length).toBeGreaterThanOrEqual(2);
      
      // Verify main contains both worker constructors
      const mainContent = api.readFile("/out/entry.js");
      api.expect(mainContent).toContain("new Worker(");
      // Should appear twice for the two workers
      const workerMatches = mainContent.match(/new Worker\(/g);
      api.expect(workerMatches?.length).toBe(2);
    },
  });
});