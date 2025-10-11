import { describe } from "bun:test";
import { readdirSync } from "fs";
import path from "path";
import { itBundled } from "./expectBundled";

describe("bundler worker comprehensive verification", () => {
  // Test WITH splitting enabled
  itBundled("worker/ComprehensiveWithSplitting", {
    files: {
      "/entry.js": `
        const worker = new Worker('./worker.js');
        worker.postMessage('hello');
        console.log('MAIN_MARKER');
      `,
      "/worker.js": `
        self.onmessage = function(e) {
          console.log('Worker received:', e.data);
        };
        console.log('WORKER_MARKER');
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      const outDirPath = path.join(api.root, "out");
      const files = readdirSync(outDirPath);
      const jsFiles = files.filter(f => f.endsWith(".js"));

      // Should have at least 2 files (entry + worker)
      if (jsFiles.length < 2) {
        throw new Error(`Expected at least 2 JS files with splitting, got ${jsFiles.length}: ${jsFiles.join(", ")}`);
      }

      const entryContent = api.readFile("/out/entry.js");

      // CRITICAL: Entry file must NOT contain worker code
      if (entryContent.includes("WORKER_MARKER")) {
        throw new Error("FAIL: entry.js contains worker code with splitting enabled!");
      }

      // Entry file must contain main code
      if (!entryContent.includes("MAIN_MARKER")) {
        throw new Error("FAIL: entry.js missing main code!");
      }

      // Entry file must have Worker constructor
      if (!entryContent.includes("new Worker(")) {
        throw new Error("FAIL: entry.js missing Worker constructor!");
      }

      // Entry file must specify {type:"module"}
      if (!entryContent.includes('type:"module"') && !entryContent.includes("type:'module'")) {
        throw new Error('FAIL: entry.js missing {type:"module"} in Worker options!');
      }

      // Find the worker file
      const workerFile = jsFiles.find(f => {
        const content = api.readFile(`/out/${f}`);
        return content.includes("WORKER_MARKER");
      });

      if (!workerFile) {
        throw new Error("FAIL: No separate worker file found containing WORKER_MARKER!");
      }

      const workerContent = api.readFile(`/out/${workerFile}`);

      // Worker file must NOT contain main code
      if (workerContent.includes("MAIN_MARKER")) {
        throw new Error(`FAIL: ${workerFile} contains main code!`);
      }

      console.log("✓ WITH SPLITTING: Worker correctly separated");
    },
  });

  // Test WITHOUT splitting enabled (the critical case we fixed)
  itBundled("worker/ComprehensiveWithoutSplitting", {
    files: {
      "/entry.js": `
        const worker = new Worker('./worker.js');
        worker.postMessage('hello');
        console.log('MAIN_MARKER');
      `,
      "/worker.js": `
        self.onmessage = function(e) {
          console.log('Worker received:', e.data);
        };
        console.log('WORKER_MARKER');
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: false, // THIS IS THE KEY TEST
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      const outDirPath = path.join(api.root, "out");
      const files = readdirSync(outDirPath);
      const jsFiles = files.filter(f => f.endsWith(".js"));

      // Should have exactly 2 files even without splitting
      if (jsFiles.length !== 2) {
        throw new Error(`Expected exactly 2 JS files without splitting, got ${jsFiles.length}: ${jsFiles.join(", ")}`);
      }

      const entryContent = api.readFile("/out/entry.js");

      // CRITICAL: Entry file must NOT contain worker code
      if (entryContent.includes("WORKER_MARKER")) {
        throw new Error("FAIL: entry.js contains worker code without splitting!");
      }

      // Entry file must contain main code
      if (!entryContent.includes("MAIN_MARKER")) {
        throw new Error("FAIL: entry.js missing main code!");
      }

      // Entry file must have Worker constructor
      if (!entryContent.includes("new Worker(")) {
        throw new Error("FAIL: entry.js missing Worker constructor!");
      }

      // Entry file must specify {type:"module"}
      if (!entryContent.includes('type:"module"') && !entryContent.includes("type:'module'")) {
        throw new Error('FAIL: entry.js missing {type:"module"} in Worker options!');
      }

      // Find the worker file
      const workerFile = jsFiles.find(f => f !== "entry.js");
      if (!workerFile) {
        throw new Error("FAIL: No separate worker file found!");
      }

      const workerContent = api.readFile(`/out/${workerFile}`);

      // Worker file must contain worker code
      if (!workerContent.includes("WORKER_MARKER")) {
        throw new Error(`FAIL: ${workerFile} missing worker code!`);
      }

      // Worker file must NOT contain main code
      if (workerContent.includes("MAIN_MARKER")) {
        throw new Error(`FAIL: ${workerFile} contains main code!`);
      }

      console.log("✓ WITHOUT SPLITTING: Worker correctly separated");
    },
  });

  // Test new URL() pattern without splitting
  itBundled("worker/NewURLPatternWithoutSplitting", {
    files: {
      "/entry.js": `
        const worker = new Worker(new URL('./worker.js', import.meta.url));
        console.log('MAIN_WITH_URL');
      `,
      "/worker.js": `
        console.log('WORKER_WITH_URL');
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: false,
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      const outDirPath = path.join(api.root, "out");
      const files = readdirSync(outDirPath);
      const jsFiles = files.filter(f => f.endsWith(".js"));

      if (jsFiles.length !== 2) {
        throw new Error(`Expected 2 JS files with new URL() pattern, got ${jsFiles.length}`);
      }

      const entryContent = api.readFile("/out/entry.js");

      if (entryContent.includes("WORKER_WITH_URL")) {
        throw new Error("FAIL: new URL() pattern - entry.js contains worker code!");
      }

      if (!entryContent.includes("MAIN_WITH_URL")) {
        throw new Error("FAIL: new URL() pattern - entry.js missing main code!");
      }

      const workerFile = jsFiles.find(f => f !== "entry.js");
      const workerContent = api.readFile(`/out/${workerFile}`);

      if (!workerContent.includes("WORKER_WITH_URL")) {
        throw new Error("FAIL: new URL() pattern - worker file missing worker code!");
      }

      if (workerContent.includes("MAIN_WITH_URL")) {
        throw new Error("FAIL: new URL() pattern - worker file contains main code!");
      }

      console.log("✓ new URL() PATTERN: Worker correctly separated");
    },
  });
});
