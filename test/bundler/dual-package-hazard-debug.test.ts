import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

// This test specifically checks if source_index changes from scanForSecondaryPaths
// cause sourcemap misalignment
test("verify dual package hazard source_index issue", async () => {
  await using dir = await tempDir("dual-pkg-source-index-debug", {
    "package.json": JSON.stringify({
      name: "test",
      type: "module",
    }),
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      main: "./cjs.js",
      module: "./esm.js",
    }),
    // ESM entry (will be resolved initially for ESM imports)
    "node_modules/pkg/esm.js": `// FILE: esm.js
export function esmFunc() {
  console.log("ESM version");
  return "esm";
}`,
    // CJS entry (will be used after dual package hazard resolution)
    "node_modules/pkg/cjs.js": `// FILE: cjs.js
module.exports = {
  cjsFunc: function() {
    console.log("CJS version");
    return "cjs";
  }
};`,
    // Import with ESM
    "a.js": `import { esmFunc } from "pkg";
export function callA() {
  return esmFunc();
}`,
    // Require with CJS - triggers dual package hazard
    "b.js": `const pkg = require("pkg");
export function callB() {
  return pkg.cjsFunc();
}`,
    "index.js": `import { callA } from "./a.js";
import { callB } from "./b.js";
console.log(callA(), callB());`,
  });

  const result = await Bun.build({
    entrypoints: [join(dir, "index.js")],
    outdir: join(dir, "out"),
    format: "esm",
    target: "bun",
    sourcemap: "external",
    minify: false,
  });

  expect(result.success).toBe(true);

  const outputFile = result.outputs.find(o => o.kind === "entry-point");
  const code = await outputFile!.text();
  const mapData = await Bun.file(outputFile!.path + ".map").text();
  const sourceMapObj = JSON.parse(mapData);

  console.log("\n=== Debug Info ===");
  console.log("Sources in sourcemap:", sourceMapObj.sources);

  // Check if esm.js appears in sources (it shouldn't after dual package hazard resolution)
  const hasESM = sourceMapObj.sources.some((s: string) => s.includes("esm.js"));
  const hasCJS = sourceMapObj.sources.some((s: string) => s.includes("cjs.js"));

  console.log("Has esm.js in sources:", hasESM);
  console.log("Has cjs.js in sources:", hasCJS);

  // After dual package hazard resolution, BOTH imports should use cjs.js
  // So sources should contain cjs.js but NOT esm.js
  if (hasESM) {
    console.warn("WARNING: esm.js appears in sources, but dual package hazard should have resolved to cjs.js");
    console.warn("This could indicate the source_index mismatch bug!");
  }

  console.log("\n=== Output Code ===");
  console.log(code);

  // Check what's actually imported in the code
  const hasESMInCode = code.includes("esm.js") || code.includes("esmFunc");
  const hasCJSInCode = code.includes("cjs.js") || code.includes("cjsFunc");

  console.log("\nCode references esm:", hasESMInCode);
  console.log("Code references cjs:", hasCJSInCode);
});
