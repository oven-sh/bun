import { describe } from "bun:test";
import { itBundled } from "./expectBundled";
import { existsSync, readdirSync } from "fs";
import path from "path";

describe("bundler worker verify", () => {
  itBundled("worker/VerifyEntryPoints", {
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
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      console.log("=== Bundle Results ===");
      
      // Check main entry point
      api.assertFileExists("/out/entry.js");
      const mainContent = api.readFile("/out/entry.js");
      console.log("Main file content:");
      console.log(mainContent);
      console.log("========================");
      
      // Try to list files in output directory
      const outDirPath = path.join(api.root, "out");
      if (existsSync(outDirPath)) {
        const files = readdirSync(outDirPath);
        console.log("Output directory files:", files);
        
        // Check each file
        for (const file of files) {
          if (file.endsWith('.js')) {
            const content = api.readFile(`/out/${file}`);
            console.log(`=== ${file} ===`);
            console.log(content);
            console.log("===============");
          }
        }
      } else {
        console.log("Output directory does not exist");
      }
    },
  });
});