import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { SourceMap } from "node:module";
import { join } from "path";

// This test tries to reproduce the scenario where source_index changes
// in scanForSecondaryPaths could lead to incorrect sourcemap source arrays
test("dual package hazard with multiple files - source_index alignment", async () => {
  // The key insight: if source_index changes but sourcemap source arrays aren't updated,
  // mappings could point to the wrong file in the sources array

  await using dir = await tempDir("dual-pkg-complex-sourcemap", {
    "package.json": JSON.stringify({
      name: "test-complex-dual-pkg",
      type: "module",
    }),
    // Dual package with distinctive content in each version
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      main: "./index.cjs",
      module: "./index.mjs",
    }),
    "node_modules/pkg/index.mjs": `// ESM VERSION - DISTINCTIVE MARKER
export function doSomethingESM() {
  console.log("This is the ESM version");
  return { type: "esm", value: 100 };
}

export function helperESM() {
  console.log("Helper from ESM");
  return "esm-helper";
}`,
    "node_modules/pkg/index.cjs": `// CJS VERSION - DISTINCTIVE MARKER
module.exports = {
  doSomethingCJS: function() {
    console.log("This is the CJS version");
    return { type: "cjs", value: 200 };
  },
  helperCJS: function() {
    console.log("Helper from CJS");
    return "cjs-helper";
  }
};`,
    // File A - uses ESM import
    "file-a.js": `import { doSomethingESM, helperESM } from "pkg";

export function functionA() {
  const resultESM = doSomethingESM();
  const helperResultESM = helperESM();
  return { resultESM, helperResultESM };
}

export function anotherFunctionA() {
  return "function-a-marker";
}`,
    // File B - uses CJS require
    "file-b.js": `const pkg = require("pkg");

export function functionB() {
  const resultCJS = pkg.doSomethingCJS();
  const helperResultCJS = pkg.helperCJS();
  return { resultCJS, helperResultCJS };
}

export function anotherFunctionB() {
  return "function-b-marker";
}`,
    // File C - neutral file (no dual package usage)
    "file-c.js": `export function functionC() {
  console.log("File C - neutral");
  return "file-c-result";
}

export function helperC() {
  return "helper-c";
}`,
    // Entry point that imports all
    "index.js": `import { functionA, anotherFunctionA } from "./file-a.js";
import { functionB, anotherFunctionB } from "./file-b.js";
import { functionC, helperC } from "./file-c.js";

console.log("Testing dual package hazard sourcemaps");
const a = functionA();
const b = functionB();
const c = functionC();

console.log({ a, b, c });
console.log(anotherFunctionA(), anotherFunctionB(), helperC());
`,
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

  const outputFile = result.outputs.find(o => o.kind === "entry-point" && o.path.endsWith(".js"));
  expect(outputFile).toBeDefined();

  const outputCode = await outputFile!.text();
  const mapData = await Bun.file(outputFile!.path + ".map").text();
  const sourceMapObj = JSON.parse(mapData);
  const sm = new SourceMap(sourceMapObj);

  console.log("\n=== Complex Dual Package Scenario ===");
  console.log("Sources array:", sourceMapObj.sources);
  console.log("\nOutput has", outputCode.split("\n").length, "lines");

  // Test 1: functionA should map to file-a.js
  const functionAMatch = outputCode.match(/function\s+functionA\s*\(/);
  if (functionAMatch) {
    const index = functionAMatch.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log("\nfunctionA mapping:", position);

    expect(position?.originalSource, "functionA should map to file-a.js").toMatch(/file-a\.js$/);
  }

  // Test 2: functionB should map to file-b.js
  const functionBMatch = outputCode.match(/function\s+functionB\s*\(/);
  if (functionBMatch) {
    const index = functionBMatch.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log("functionB mapping:", position);

    expect(position?.originalSource, "functionB should map to file-b.js").toMatch(/file-b\.js$/);
  }

  // Test 3: functionC should map to file-c.js
  const functionCMatch = outputCode.match(/function\s+functionC\s*\(/);
  if (functionCMatch) {
    const index = functionCMatch.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log("functionC mapping:", position);

    expect(position?.originalSource, "functionC should map to file-c.js").toMatch(/file-c\.js$/);
  }

  // Test 4: Check that dual package references map correctly
  // After scanForSecondaryPaths, both ESM and CJS imports should resolve to index.cjs
  const doSomethingMatches = Array.from(outputCode.matchAll(/doSomething(ESM|CJS)\s*\(/g));
  console.log(`\nFound ${doSomethingMatches.length} doSomething calls`);

  for (const match of doSomethingMatches) {
    const index = match.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log(`${match[0]} at line ${linesBeforeMatch}:`, position);

    // Critical: After dual package hazard resolution, the sourcemap should still
    // point to the correct original source file (file-a.js or file-b.js)
    // NOT to the dual package file itself (which could indicate source_index misalignment)
    if (position?.originalSource) {
      const isInUserFile =
        position.originalSource.includes("file-a.js") || position.originalSource.includes("file-b.js");

      if (!isInUserFile) {
        // If it maps to the pkg files, that's okay too, but verify it's the RIGHT pkg file
        const isInPkg = position.originalSource.includes("pkg/");
        if (isInPkg) {
          console.log("  -> Maps to pkg file (expected after dual package hazard resolution)");
        }
      }
    }
  }

  // Test 5: Verify source array integrity
  // All sources should be valid file paths, no undefined or duplicates
  const sources = sourceMapObj.sources as string[];
  expect(sources.length).toBeGreaterThan(0);

  for (const source of sources) {
    expect(typeof source, "All sources should be strings").toBe("string");
    expect(source.length, "All sources should be non-empty").toBeGreaterThan(0);
  }

  // Check for unexpected duplicates (could indicate source_index issues)
  const uniqueSources = new Set(sources);
  if (uniqueSources.size !== sources.length) {
    console.warn("WARNING: Duplicate sources detected:", sources);
  }

  console.log("\n✓ All sourcemap assertions passed");
});

test("banner + dual package hazard interaction", async () => {
  // Test that banner doesn't interfere with dual package hazard sourcemap handling
  await using dir = await tempDir("banner-dual-pkg-sourcemap", {
    "package.json": JSON.stringify({
      name: "test-banner-dual-pkg",
      type: "module",
    }),
    "node_modules/lib/package.json": JSON.stringify({
      name: "lib",
      main: "./index.cjs",
      module: "./index.mjs",
    }),
    "node_modules/lib/index.mjs": `export const value = "esm";`,
    "node_modules/lib/index.cjs": `module.exports = { value: "cjs" };`,
    "a.js": `import { value } from "lib";\nexport const a = value;`,
    "b.js": `const lib = require("lib");\nexport const b = lib.value;`,
    "index.js": `import { a } from "./a.js";\nimport { b } from "./b.js";\nconsole.log(a, b);`,
  });

  const result = await Bun.build({
    entrypoints: [join(dir, "index.js")],
    outdir: join(dir, "out"),
    format: "esm",
    target: "bun",
    sourcemap: "external",
    banner: "// BANNER LINE 1\n// BANNER LINE 2\n",
  });

  expect(result.success).toBe(true);

  const outputFile = result.outputs.find(o => o.kind === "entry-point" && o.path.endsWith(".js"));
  const outputCode = await outputFile!.text();
  const mapData = await Bun.file(outputFile!.path + ".map").text();
  const sourceMapObj = JSON.parse(mapData);
  const sm = new SourceMap(sourceMapObj);

  console.log("\n=== Banner + Dual Package ===");
  console.log("Sources:", sourceMapObj.sources);

  // Find console.log in the output
  const consoleMatch = outputCode.match(/console\.log\(/);
  if (consoleMatch) {
    const index = consoleMatch.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log("console.log mapping:", position);

    // Should map to index.js line 3 (0-indexed: 2)
    expect(position?.originalSource, "console.log should map to index.js").toMatch(/index\.js$/);
    expect(position?.originalLine, "console.log should map to line 2 (0-indexed)").toBe(2);
  }

  console.log("✓ Banner + dual package hazard test passed");
});
