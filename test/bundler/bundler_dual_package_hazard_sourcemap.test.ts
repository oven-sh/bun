import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { SourceMap } from "node:module";
import { join } from "path";

test("dual package hazard rewrites should preserve correct sourcemaps", async () => {
  // Create a dual package hazard scenario:
  // - package.json with both "main" (CJS) and "module" (ESM)
  // - One file imports with ESM, another requires with CJS
  // - This triggers scanForSecondaryPaths rewriting

  await using dir = await tempDir("dual-package-hazard-sourcemap", {
    "package.json": JSON.stringify({
      name: "test-dual-package-hazard",
      type: "module",
    }),
    // The dual package - has both ESM and CJS versions
    "node_modules/dual-pkg/package.json": JSON.stringify({
      name: "dual-pkg",
      main: "./cjs-entry.js",
      module: "./esm-entry.js",
    }),
    // ESM version of the package
    "node_modules/dual-pkg/esm-entry.js": `export function hello() {
  console.log("Hello from ESM");
  return "esm-result";
}`,
    // CJS version of the package
    "node_modules/dual-pkg/cjs-entry.js": `module.exports = function hello() {
  console.log("Hello from CJS");
  return "cjs-result";
};`,
    // File that imports with ESM
    "esm-importer.js": `import { hello } from "dual-pkg";
export function callHelloESM() {
  return hello();
}`,
    // File that requires with CJS (use dynamic import to trigger dual package hazard)
    "cjs-importer.js": `const hello = require("dual-pkg");
export function callHelloCJS() {
  return hello();
}`,
    // Entry point that uses both
    "index.js": `import { callHelloESM } from "./esm-importer.js";
import { callHelloCJS } from "./cjs-importer.js";

console.log("ESM:", callHelloESM());
console.log("CJS:", callHelloCJS());
`,
  });

  // Build with sourcemaps
  const result = await Bun.build({
    entrypoints: [join(dir, "index.js")],
    outdir: join(dir, "out"),
    format: "esm",
    target: "bun",
    sourcemap: "external",
    minify: false,
  });

  expect(result.success).toBe(true);

  // Find the output file
  const outputFile = result.outputs.find(o => o.kind === "entry-point" && o.path.endsWith(".js"));
  expect(outputFile).toBeDefined();

  const outputCode = await outputFile!.text();
  const mapData = await Bun.file(outputFile!.path + ".map").text();
  const sourceMapObj = JSON.parse(mapData);
  const sm = new SourceMap(sourceMapObj);

  console.log("Sources:", sourceMapObj.sources);
  console.log("\n=== Output Code ===");
  console.log(outputCode);

  // Find callHelloESM in the output
  const callHelloESMMatch = outputCode.match(/callHelloESM\s*\(/);
  if (callHelloESMMatch) {
    const index = callHelloESMMatch.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log("\ncallHelloESM mapping:", position);

    // Verify it maps to the correct source file (esm-importer.js, not index.js or cjs-importer.js)
    expect(position?.originalSource).toMatch(/esm-importer\.js$/);
  }

  // Find callHelloCJS in the output
  const callHelloCJSMatch = outputCode.match(/callHelloCJS\s*\(/);
  if (callHelloCJSMatch) {
    const index = callHelloCJSMatch.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log("callHelloCJS mapping:", position);

    // Verify it maps to the correct source file (cjs-importer.js, not index.js or esm-importer.js)
    expect(position?.originalSource).toMatch(/cjs-importer\.js$/);
  }

  // Find the hello function call from the dual package
  // After dual package hazard resolution, both should point to the same file (CJS version)
  const helloMatches = Array.from(outputCode.matchAll(/\bhello\s*\(/g));
  console.log(`\nFound ${helloMatches.length} hello() calls`);

  for (const match of helloMatches) {
    const index = match.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log(`hello() at output line ${linesBeforeMatch}:`, position);

    // The key assertion: sourcemap should point to the ACTUAL source file
    // not a misaligned file due to source_index changes in scanForSecondaryPaths
    if (position?.originalSource) {
      // Should map to either esm-importer.js, cjs-importer.js, or the dual-pkg files
      // NOT to index.js (which would indicate source_index misalignment)
      const isValidSource =
        position.originalSource.includes("esm-importer.js") ||
        position.originalSource.includes("cjs-importer.js") ||
        position.originalSource.includes("esm-entry.js") ||
        position.originalSource.includes("cjs-entry.js");

      expect(isValidSource, `hello() should not map to wrong source file: ${position.originalSource}`).toBe(true);
    }
  }
});

test("dual package hazard with tslib scenario", async () => {
  // Reproduce the tslib scenario mentioned by the user
  // tslib has dual package hazard and is commonly bundled

  await using dir = await tempDir("tslib-dual-package-sourcemap", {
    "package.json": JSON.stringify({
      name: "test-tslib-scenario",
      type: "module",
    }),
    // Simulate tslib with dual package hazard
    "node_modules/tslib/package.json": JSON.stringify({
      name: "tslib",
      main: "./tslib.js",
      module: "./tslib.es6.js",
    }),
    "node_modules/tslib/tslib.js": `// TypeScript runtime library (CJS)
exports.__extends = function (d, b) {
  for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
  function __() { this.constructor = d; }
  d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};

exports.__assign = function () {
  exports.__assign = Object.assign || function (t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
    }
    return t;
  };
  return exports.__assign.apply(this, arguments);
};`,
    "node_modules/tslib/tslib.es6.js": `// TypeScript runtime library (ESM)
export function __extends(d, b) {
  for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
  function __() { this.constructor = d; }
  d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}

export var __assign = Object.assign || function (t) {
  for (var s, i = 1, n = arguments.length; i < n; i++) {
    s = arguments[i];
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
  }
  return t;
};`,
    // File using tslib with ESM import
    "class-a.ts": `import { __extends } from "tslib";

class BaseClass {
  constructor(public name: string) {}
}

class DerivedClass extends BaseClass {
  constructor(name: string, public value: number) {
    super(name);
  }
}

export { DerivedClass };`,
    // File using tslib with CJS require
    "class-b.js": `const tslib = require("tslib");

function createObject(base, overrides) {
  return tslib.__assign({}, base, overrides);
}

module.exports = { createObject };`,
    // Entry point
    "index.js": `import { DerivedClass } from "./class-a.ts";
const { createObject } = require("./class-b.js");

const obj = new DerivedClass("test", 42);
const merged = createObject({ a: 1 }, { b: 2 });

console.log(obj, merged);
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

  console.log("\n=== tslib scenario ===");
  console.log("Sources:", sourceMapObj.sources);

  // Find __extends usage
  const extendsMatch = outputCode.match(/__extends\s*\(/);
  if (extendsMatch) {
    const index = extendsMatch.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log("__extends mapping:", position);

    // Should map to tslib or class-a.ts, not to a wrong file due to source_index misalignment
    if (position?.originalSource) {
      expect(
        position.originalSource,
        "tslib functions should map to correct source after dual package hazard resolution",
      ).toMatch(/tslib|class-a\.ts/);
    }
  }

  // Find __assign usage
  const assignMatch = outputCode.match(/__assign\s*\(/);
  if (assignMatch) {
    const index = assignMatch.index!;
    const linesBeforeMatch = outputCode.substring(0, index).split("\n").length;
    const lineStart = outputCode.lastIndexOf("\n", index - 1) + 1;
    const column = index - lineStart;

    const position = sm.findEntry(linesBeforeMatch - 1, column);
    console.log("__assign mapping:", position);

    if (position?.originalSource) {
      expect(
        position.originalSource,
        "tslib functions should map to correct source after dual package hazard resolution",
      ).toMatch(/tslib|class-b\.js/);
    }
  }
});
