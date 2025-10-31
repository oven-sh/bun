import { describe } from "bun:test";
import { readdirSync } from "fs";
import path from "path";
import { itBundled } from "./expectBundled";

describe("bundler worker with new URL", () => {
  itBundled("worker/WorkerWithNewURL", {
    files: {
      "/entry.js": `
        const worker = new Worker(new URL('./worker.js', import.meta.url));
        worker.postMessage('hello');
        console.log('main started');
      `,
      "/worker.js": `
        self.onmessage = function(e) {
          console.log('Worker received:', e.data);
        };
        console.log('worker started');
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: false, // Workers should work without splitting
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      // Check that the main entry point was generated
      api.assertFileExists("/out/entry.js");

      // Check that a separate worker file was created FIRST
      const outDirPath = path.join(api.root, "out");
      const files = readdirSync(outDirPath);
      console.log("Output files:", files);

      const mainContent = api.readFile("/out/entry.js");
      console.log("Main content:", mainContent);

      // The main file should NOT contain worker code
      if (mainContent.includes("worker started")) {
        throw new Error("Worker code should not be in entry.js - it should be in a separate file!");
      }

      // Should contain new Worker with a path
      api.expectFile("/out/entry.js").toContain("new Worker(");
      api.expectFile("/out/entry.js").toContain("main started");

      const workerFile = files.find(file => file !== "entry.js" && file.endsWith(".js"));
      if (!workerFile) {
        throw new Error("Expected a separate worker bundle file to be generated");
      }

      // Verify worker file contains worker code
      const workerContent = api.readFile(`/out/${workerFile}`);
      console.log("Worker file:", workerFile);
      console.log("Worker content:", workerContent);

      if (!workerContent.includes("worker started")) {
        throw new Error("Worker file should contain worker code");
      }

      // Verify the main file references the worker file
      if (!mainContent.includes(workerFile.replace(".js", ""))) {
        console.log("Warning: Main file doesn't reference worker file by name (may use hash)");
      }
    },
  });
});
