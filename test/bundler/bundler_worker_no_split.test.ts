import { describe } from "bun:test";
import { existsSync, readdirSync } from "fs";
import path from "path";
import { itBundled } from "./expectBundled";

describe("bundler worker without splitting", () => {
  itBundled("worker/NoSplitting", {
    files: {
      "/entry.js": `
        const worker = new Worker('./worker.js');
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
    splitting: false, // THIS IS THE KEY DIFFERENCE
    outdir: "/out",
    onAfterBundle(api) {
      console.log("=== Bundle Results (NO SPLITTING) ===");

      // Check main entry point
      api.assertFileExists("/out/entry.js");

      // Try to list files in output directory
      const outDirPath = path.join(api.root, "out");
      if (existsSync(outDirPath)) {
        const files = readdirSync(outDirPath);
        console.log("Output directory files:", files);

        // Check each file
        for (const file of files) {
          if (file.endsWith(".js")) {
            const content = api.readFile(`/out/${file}`);
            console.log(`=== ${file} ===`);
            console.log(content);
            console.log("===============");
          }
        }

        // Verify we have 2 JS files
        const jsFiles = files.filter(f => f.endsWith(".js"));
        if (jsFiles.length !== 2) {
          throw new Error(`Expected 2 JS files, got ${jsFiles.length}: ${jsFiles.join(", ")}`);
        }

        // Verify entry.js doesn't contain worker code
        const entryContent = api.readFile("/out/entry.js");
        if (entryContent.includes("worker started")) {
          throw new Error("entry.js should not contain worker code!");
        }
      } else {
        console.log("Output directory does not exist");
        throw new Error("Output directory should exist");
      }
    },
  });
});
