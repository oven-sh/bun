import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { SourceMap } from "node:module";
import { basename, join } from "path";

// Define test file contents as constants
const testFiles = {
  "input.js": `// Complex test file with classes, methods, and exports
import { readFileSync } from "fs";

// Base class with properties
export class Logger {
  constructor(name) {
    this.name = name;
    this.level = "info";
  }

  log(message) {
    console.log(\`[\${this.name}] \${message}\`);
  }

  debug(message) {
    if (this.level === "debug") {
      console.debug(\`[DEBUG][\${this.name}] \${message}\`);
    }
  }
}

// Derived class
export class FileLogger extends Logger {
  constructor(name, filepath) {
    super(name);
    this.filepath = filepath;
    this.buffer = [];
  }

  log(message) {
    super.log(message);
    this.buffer.push(message);
  }

  flush() {
    const content = this.buffer.join("\\n");
    console.log("Flushing to file:", this.filepath);
    return content;
  }
}

// Standalone function using this
export function createCounter(initial = 0) {
  return {
    value: initial,
    increment() {
      this.value++;
      return this.value;
    },
    decrement() {
      this.value--;
      return this.value;
    },
    reset() {
      this.value = initial;
    }
  };
}

// Factory with private state
export const loggerFactory = (() => {
  const instances = new Map();

  return {
    create(name) {
      if (!instances.has(name)) {
        instances.set(name, new Logger(name));
      }
      return instances.get(name);
    },
    destroy(name) {
      instances.delete(name);
    }
  };
})();

// Default export
export default class Application {
  constructor(config) {
    this.config = config;
    this.logger = new Logger("App");
    this.running = false;
  }

  start() {
    this.running = true;
    this.logger.log("Application started");
    return this;
  }

  stop() {
    this.running = false;
    this.logger.log("Application stopped");
  }
}
`,
  // Additional file for dynamic import testing
  "utils.js": `// Utility module for dynamic imports
export class DatabaseConnection {
  constructor(connectionString) {
    this.connectionString = connectionString;
    this.connected = false;
  }

  async connect() {
    console.log("Connecting to database...");
    this.connected = true;
    return this;
  }

  async query(sql) {
    if (!this.connected) {
      throw new Error("Not connected");
    }
    console.log("Executing query:", sql);
    return { rows: [], count: 0 };
  }

  disconnect() {
    this.connected = false;
    console.log("Disconnected from database");
  }
}

export function validateEmail(email) {
  const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return regex.test(email);
}

export const constants = {
  MAX_RETRIES: 3,
  TIMEOUT: 5000,
  API_VERSION: "v1"
};
`,
  // Entry point with dynamic imports
  "main.js": `// Main entry point with dynamic imports
import { Logger } from "./input.js";

const logger = new Logger("Main");

// Dynamic import for code splitting
async function loadUtils() {
  const utils = await import("./utils.js");
  const db = new utils.DatabaseConnection("postgres://localhost");
  await db.connect();
  logger.log("Utils loaded and DB connected");
  return utils;
}

async function validateUser(email) {
  const { validateEmail } = await import("./utils.js");
  const isValid = validateEmail(email);
  logger.log(\`Email \${email} is \${isValid ? "valid" : "invalid"}\`);
  return isValid;
}

// Another dynamic import point
async function initializeApp() {
  const { default: Application } = await import("./input.js");
  const app = new Application({ name: "MyApp" });
  app.start();
  return app;
}

export { loadUtils, validateUser, initializeApp };
`,
};

const formats = ["cjs", "esm", "iife"] as const;
const targets = ["bun", "node", "browser"] as const;
const sourcemaps = ["inline", "external", "linked"] as const;
const splittingOptions = [false, true] as const;
const minifyOptions = [
  { name: "none", minifyIdentifiers: false, minifyWhitespace: false, minifySyntax: false },
  { name: "identifiers", minifyIdentifiers: true, minifyWhitespace: false, minifySyntax: false },
  { name: "whitespace", minifyIdentifiers: false, minifyWhitespace: true, minifySyntax: false },
  { name: "syntax", minifyIdentifiers: false, minifyWhitespace: false, minifySyntax: true },
] as const;
const banners = [
  { name: "simple", content: "// This is a banner comment\n// Line 2 of banner" },
  { name: "multiline", content: "// Multi-line banner\n// Line 2\n// Line 3\n// Line 4\n// Line 5" },
  { name: "shebang-start", content: "#!/usr/bin/env node\n// Banner after shebang\n// Line 3" },
  { name: "shebang-end", content: "// Banner before shebang\n// Line 2\n#!/usr/bin/env node" },
] as const;

for (const format of formats) {
  for (const target of targets) {
    for (const sourcemap of sourcemaps) {
      for (const splitting of splittingOptions) {
        for (const minify of minifyOptions) {
          for (const banner of banners) {
            // Code splitting only works with ESM format
            if (splitting && format !== "esm") {
              continue;
            }

            const testName = `format=${format}, target=${target}, sourcemap=${sourcemap}, splitting=${splitting}, minify=${minify.name}, banner=${banner.name}`;

            test.concurrent(testName, async () => {
              // Create temp directory for this test
              using dir = tempDir(`banner-sourcemap-${format}-${target}-${sourcemap}`, testFiles);

              // Build with banner
              const entrypoint = splitting ? join(dir, "main.js") : join(dir, "input.js");
              const result = await Bun.build({
                entrypoints: [entrypoint],
                outdir: dir,
                naming: splitting
                  ? `split-${target}-${sourcemap}-${minify.name}-${banner.name}/[name].[ext]`
                  : `output-${format}-${target}-${sourcemap}-${minify.name}-${banner.name}.js`,
                format,
                target,
                sourcemap,
                splitting,
                minify: {
                  identifiers: minify.minifyIdentifiers,
                  whitespace: minify.minifyWhitespace,
                  syntax: minify.minifySyntax,
                },
                banner: banner.content,
              });

              expect(result.success, `${testName}: build failed\n${result.logs.join("\n")}`).toBe(true);

              // Always filter to JS chunks only (not assets or sourcemaps)
              // kind can be "entry-point", "chunk", etc. but not "asset" or "sourcemap"
              const outputsToCheck = result.outputs.filter(o => o.kind !== "sourcemap" && o.path.endsWith(".js"));
              expect(outputsToCheck.length, `${testName}: no JS outputs found`).toBeGreaterThan(0);

              for (const output of outputsToCheck) {
                const outputCode = await output.text();
                const outfile = output.path;
                const chunkName = splitting ? ` (chunk: ${basename(output.path)})` : "";
                const chunkTestName = `${testName}${chunkName}`;

                // Verify Bun-specific directives for target=bun
                if (target === "bun") {
                  if (format === "cjs") {
                    expect(outputCode, `${chunkTestName}: should contain // @bun @bun-cjs directive`).toContain(
                      "// @bun @bun-cjs",
                    );
                  } else if (format === "esm") {
                    expect(outputCode, `${chunkTestName}: should contain // @bun directive`).toContain("// @bun");
                    // Make sure it's not the CJS variant
                    expect(outputCode, `${chunkTestName}: should not contain @bun-cjs for ESM`).not.toContain(
                      "@bun-cjs",
                    );
                  }
                }

                // Verify banner presence (skip shebang lines which may be processed differently)
                {
                  const nonShebangBannerLines = banner.content
                    .split("\n")
                    .filter(l => !l.startsWith("#!"))
                    .filter(l => l.trim().length > 0);
                  for (const line of nonShebangBannerLines) {
                    expect(outputCode, `${chunkTestName}: banner line missing: ${JSON.stringify(line)}`).toContain(
                      line,
                    );
                  }
                  // Shebang (if present at start) should be the very first line of entry-point chunks only
                  if (banner.name === "shebang-start" && output.kind === "entry-point") {
                    expect(outputCode.startsWith("#!"), `${chunkTestName}: shebang should be first line`).toBe(true);
                  }
                }

                // Extract sourcemap based on type
                let sourcemapData: string;

                if (sourcemap === "inline") {
                  // Extract inline sourcemap from data URL (accept optional charset)
                  const match = outputCode.match(
                    /\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;]+)?;base64,([^\s]+)/,
                  );
                  expect(match, `${chunkTestName}: inline sourcemap not found`).not.toBeNull();
                  sourcemapData = Buffer.from(match![1], "base64").toString("utf-8");
                } else if (sourcemap === "linked") {
                  // Verify sourceMappingURL comment exists
                  expect(outputCode, `${chunkTestName}: linked sourcemap comment not found`).toMatch(
                    /\/\/# sourceMappingURL=.*\.js\.map/,
                  );
                  const mapfile = `${outfile}.map`;
                  sourcemapData = await Bun.file(mapfile).text();
                } else {
                  // external
                  const mapfile = `${outfile}.map`;
                  sourcemapData = await Bun.file(mapfile).text();
                }

                // Parse and validate sourcemap structure
                const sourceMapObj = JSON.parse(sourcemapData);
                expect(typeof sourceMapObj, `${chunkTestName}: sourcemap should be an object`).toBe("object");
                expect(sourceMapObj, `${chunkTestName}: sourcemap should not be null`).not.toBeNull();
                expect(Number.isInteger(sourceMapObj.version), `${chunkTestName}: version should be an integer`).toBe(
                  true,
                );
                expect(sourceMapObj.version, `${chunkTestName}: version should be 3`).toBe(3);
                expect(Array.isArray(sourceMapObj.sources), `${chunkTestName}: sources should be an array`).toBe(true);

                // Skip runtime helper chunks (chunks with no sources - these are generated code)
                if (!sourceMapObj.sources || sourceMapObj.sources.length === 0 || !sourceMapObj.mappings) {
                  // This is expected for runtime helper chunks in code splitting
                  continue;
                }

                expect(sourceMapObj.mappings, `${chunkTestName}: mappings should be a non-empty string`).toBeTruthy();
                expect(typeof sourceMapObj.mappings, `${chunkTestName}: mappings should be string type`).toBe("string");

                // Use node:module SourceMap to validate
                const sm = new SourceMap(sourceMapObj);

                // The banner should NOT affect the source mapping
                // Different checks for different chunks
                const isInputChunk = outfile.includes("input") || !splitting;
                const isUtilsChunk = outfile.includes("utils");
                const isMainChunk = outfile.includes("main");

                // Test mappings based on which chunk we're in - require at least one anchor match
                if (isInputChunk) {
                  // Test 1: Check mapping in the middle of the file - the flush() method (line 42, 0-indexed: 41)
                  // Use minification-resistant pattern
                  const flushMatch = outputCode.match(/flush\s*\(/);
                  expect(flushMatch, `${chunkTestName}: flush method not found in input chunk`).not.toBeNull();

                  const flushIndex = flushMatch!.index!;
                  const linesBeforeFlush = outputCode.substring(0, flushIndex).split("\n").length;
                  const flushLineStart = outputCode.lastIndexOf("\n", flushIndex - 1) + 1;
                  const flushColumn = flushIndex - flushLineStart;
                  const flushPosition = sm.findEntry(linesBeforeFlush - 1, flushColumn);

                  expect(
                    flushPosition?.originalLine,
                    `${chunkTestName}: flush() should map to original line 34 (0-indexed), got ${flushPosition?.originalLine}`,
                  ).toBe(34);
                  expect(flushPosition?.originalSource, `${chunkTestName}: source should be input.js`).toMatch(
                    /input\.js$/,
                  );

                  // Test 2: Check mapping for this.buffer.push (line 39, 0-indexed: 38)
                  // Use minification-resistant pattern - match the call structure, not argument names
                  const bufferPushMatch = outputCode.match(/this\.buffer\.push\s*\(/);
                  if (bufferPushMatch) {
                    const bufferPushIndex = bufferPushMatch.index!;
                    const linesBeforePush = outputCode.substring(0, bufferPushIndex).split("\n").length;
                    const pushLineStart = outputCode.lastIndexOf("\n", bufferPushIndex - 1) + 1;
                    const pushColumn = bufferPushIndex - pushLineStart;
                    const pushPosition = sm.findEntry(linesBeforePush - 1, pushColumn);

                    expect(
                      pushPosition?.originalLine,
                      `${chunkTestName}: this.buffer.push should map to original line 31 (0-indexed), got ${pushPosition?.originalLine}`,
                    ).toBe(31);
                  }
                }

                if (isUtilsChunk) {
                  // Test for utils.js - use minification-resistant pattern
                  const connectMatch = outputCode.match(/\bconnect\s*\(/);
                  expect(connectMatch, `${chunkTestName}: connect method not found in utils chunk`).not.toBeNull();

                  const connectIndex = connectMatch!.index!;
                  const linesBeforeConnect = outputCode.substring(0, connectIndex).split("\n").length;
                  const connectLineStart = outputCode.lastIndexOf("\n", connectIndex - 1) + 1;
                  const connectColumn = connectIndex - connectLineStart;
                  const connectPosition = sm.findEntry(linesBeforeConnect - 1, connectColumn);

                  expect(
                    connectPosition?.originalLine,
                    `${chunkTestName}: connect() should map to utils.js line 11 (0-indexed), got ${connectPosition?.originalLine}`,
                  ).toBe(11);

                  // Test validateEmail - match identifier only
                  const validateMatch = outputCode.match(/\bvalidateEmail\b/);
                  if (validateMatch) {
                    const validateIndex = validateMatch.index!;
                    const linesBeforeValidate = outputCode.substring(0, validateIndex).split("\n").length;
                    const validateLineStart = outputCode.lastIndexOf("\n", validateIndex - 1) + 1;
                    const validateColumn = validateIndex - validateLineStart;
                    const validatePosition = sm.findEntry(linesBeforeValidate - 1, validateColumn);

                    expect(
                      validatePosition?.originalLine,
                      `${chunkTestName}: validateEmail should map to utils.js line 31 (0-indexed), got ${validatePosition?.originalLine}`,
                    ).toBe(31);
                  }
                }

                if (isMainChunk) {
                  // Test for main.js - skip if identifiers are minified
                  // With minifyIdentifiers, the function name is mangled and "loadUtils" only exists as an export alias
                  // which doesn't have a sourcemap entry
                  if (!minify.minifyIdentifiers) {
                    const loadUtilsMatch = outputCode.match(/\bloadUtils\b/);
                    if (loadUtilsMatch) {
                      const loadUtilsIndex = loadUtilsMatch.index!;
                      const linesBeforeLoadUtils = outputCode.substring(0, loadUtilsIndex).split("\n").length;
                      const loadUtilsLineStart = outputCode.lastIndexOf("\n", loadUtilsIndex - 1) + 1;
                      const loadUtilsColumn = loadUtilsIndex - loadUtilsLineStart;
                      const loadUtilsPosition = sm.findEntry(linesBeforeLoadUtils - 1, loadUtilsColumn);

                      expect(
                        loadUtilsPosition?.originalLine,
                        `${chunkTestName}: loadUtils should map to main.js line 6 (0-indexed), got ${loadUtilsPosition?.originalLine}`,
                      ).toBe(6);
                    }
                  }
                }
              }
            });
          }
        }
      }
    }
  }
}
