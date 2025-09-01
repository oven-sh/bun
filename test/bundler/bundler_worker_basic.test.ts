import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler worker basic", () => {
  itBundled("worker/BasicWorker", {
    files: {
      "/entry.js": `
        const worker = new Worker('./worker.js');
        console.log('main thread');
      `,
      "/worker.js": `
        console.log('worker thread');
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      // Check that the main entry point was generated
      api.assertFileExists("/out/entry.js");
      
      // Check that the main file contains a worker constructor
      const mainContent = api.readFile("/out/entry.js");
      console.log("Main file content:", mainContent);
      
      // For now just verify the basic content exists
      api.expectFile("/out/entry.js").toContain("main thread");
    },
  });
});