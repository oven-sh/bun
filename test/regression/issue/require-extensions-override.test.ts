import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Module._extensions override should not allow TypeScript syntax in .js files", async () => {
  using dir = tempDir("module-extensions-ts-in-js", {
    "index.js": `
      const Module = require("module");
      const orig = Module._extensions[".js"];

      // Override the .js extension handler with a wrapper
      Module._extensions[".js"] = (m, f) => {
        return orig(m, f);
      };

      // This should error because it has TypeScript syntax in a .js file
      try {
        require("./typescript-syntax.js");
        console.log("ERROR: Should have failed to parse TypeScript syntax in .js file");
        process.exit(1);
      } catch (err) {
        console.log("SUCCESS: Correctly rejected TypeScript syntax in .js file");
        process.exit(0);
      }
    `,
    "typescript-syntax.js": `
      const value: string = "hello";
      export { value };
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS: Correctly rejected TypeScript syntax in .js file");
});

test("Module._extensions override should not allow JSX syntax in .js files", async () => {
  using dir = tempDir("module-extensions-jsx-in-js", {
    "index.js": `
      const Module = require("module");
      const orig = Module._extensions[".js"];

      // Override the .js extension handler
      Module._extensions[".js"] = (m, f) => {
        console.log("Loading:", f);
        return orig(m, f);
      };

      // This should error because it has JSX syntax in a .js file
      try {
        require("./jsx-syntax.js");
        console.log("ERROR: Should have failed to parse JSX syntax in .js file");
        process.exit(1);
      } catch (err) {
        console.log("SUCCESS: Correctly rejected JSX syntax in .js file");
        process.exit(0);
      }
    `,
    "jsx-syntax.js": `
      const element = <div>Hello</div>;
      export { element };
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS: Correctly rejected JSX syntax in .js file");
});

test("Module._extensions override should preserve loader type for each extension", async () => {
  using dir = tempDir("module-extensions-loader-types", {
    "index.js": `
      const Module = require("module");
      const results = [];

      // Save original loaders
      const origJS = Module._extensions[".js"];
      const origTS = Module._extensions[".ts"];
      const origJSON = Module._extensions[".json"];

      // Override each with a wrapper
      Module._extensions[".js"] = (m, f) => {
        results.push(".js loader called");
        return origJS(m, f);
      };

      Module._extensions[".ts"] = (m, f) => {
        results.push(".ts loader called");
        return origTS(m, f);
      };

      Module._extensions[".json"] = (m, f) => {
        results.push(".json loader called");
        return origJSON(m, f);
      };

      // Test .js file with JavaScript (should work)
      try {
        const js = require("./plain.js");
        results.push("plain.js loaded: " + js.type);
      } catch (err) {
        results.push("ERROR loading plain.js: " + err.message);
      }

      // Test .ts file with TypeScript (should work)
      try {
        const ts = require("./typed.ts");
        results.push("typed.ts loaded: " + ts.type);
      } catch (err) {
        results.push("ERROR loading typed.ts: " + err.message);
      }

      // Test .json file (should work)
      try {
        const json = require("./data.json");
        results.push("data.json loaded: " + json.type);
      } catch (err) {
        results.push("ERROR loading data.json: " + err.message);
      }

      // Test .js file with TypeScript syntax (should fail)
      try {
        require("./typescript-in-js.js");
        results.push("ERROR: typescript-in-js.js should have failed");
      } catch (err) {
        results.push("typescript-in-js.js correctly failed");
      }

      console.log(results.join("\\n"));
    `,
    "plain.js": `
      module.exports = { type: "javascript" };
    `,
    "typed.ts": `
      interface Data {
        type: string;
      }
      const data: Data = { type: "typescript" };
      module.exports = data;
    `,
    "data.json": `
      { "type": "json" }
    `,
    "typescript-in-js.js": `
      const value: string = "should fail";
      module.exports = value;
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain(".js loader called");
  expect(stdout).toContain(".ts loader called");
  expect(stdout).toContain(".json loader called");
  expect(stdout).toContain("plain.js loaded: javascript");
  expect(stdout).toContain("typed.ts loaded: typescript");
  expect(stdout).toContain("data.json loaded: json");
  expect(stdout).toContain("typescript-in-js.js correctly failed");
});

test("Module._extensions override with custom function should not affect loader type", async () => {
  using dir = tempDir("module-extensions-custom-function", {
    "index.js": `
      const Module = require("module");
      const fs = require("fs");

      // Override .js with a completely custom function (not wrapping the original)
      Module._extensions[".js"] = function(module, filename) {
        // Custom implementation that mimics the original
        const content = fs.readFileSync(filename, 'utf8');
        module._compile(content, filename);
      };

      // This should still fail with TypeScript syntax in .js
      try {
        require("./typescript.js");
        console.log("ERROR: Should have failed with TypeScript in .js");
        process.exit(1);
      } catch (err) {
        console.log("SUCCESS: Correctly failed with custom loader");
        process.exit(0);
      }
    `,
    "typescript.js": `
      const x: number = 42;
      module.exports = x;
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS: Correctly failed with custom loader");
});

test("Module._extensions override should handle cross-assignment correctly", async () => {
  using dir = tempDir("module-extensions-cross-assign", {
    "index.js": `
      const Module = require("module");

      // Save original loaders
      const origJS = Module._extensions[".js"];
      const origTS = Module._extensions[".ts"];

      // Cross-assign: .js uses .ts loader, .ts uses .js loader
      Module._extensions[".js"] = origTS;
      Module._extensions[".ts"] = origJS;

      // Now .js files should accept TypeScript syntax
      try {
        const jsWithTS = require("./typescript-syntax.js");
        console.log("SUCCESS: .js with TS loader accepts TypeScript:", jsWithTS.value);
      } catch (err) {
        console.log("ERROR: .js with TS loader failed:", err.message);
        process.exit(1);
      }

      // And .ts files should reject TypeScript syntax
      try {
        require("./typescript-syntax.ts");
        console.log("ERROR: .ts with JS loader should reject TypeScript");
        process.exit(1);
      } catch (err) {
        console.log("SUCCESS: .ts with JS loader correctly rejects TypeScript");
      }
    `,
    "typescript-syntax.js": `
      const value: string = "typescript";
      module.exports = { value };
    `,
    "typescript-syntax.ts": `
      const value: string = "typescript";
      module.exports = { value };
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS: .js with TS loader accepts TypeScript");
  expect(stdout).toContain("SUCCESS: .ts with JS loader correctly rejects TypeScript");
});

test("Module._extensions override chain should preserve correct loader", async () => {
  using dir = tempDir("module-extensions-chain", {
    "index.js": `
      const Module = require("module");
      const origJS = Module._extensions[".js"];

      // Create a chain of wrappers
      Module._extensions[".js"] = (m, f) => {
        console.log("Wrapper 1");
        return origJS(m, f);
      };

      const wrapper1 = Module._extensions[".js"];
      Module._extensions[".js"] = (m, f) => {
        console.log("Wrapper 2");
        return wrapper1(m, f);
      };

      // Should still reject TypeScript in .js
      try {
        require("./typescript.js");
        console.log("ERROR: Should reject TypeScript in .js");
        process.exit(1);
      } catch (err) {
        console.log("SUCCESS: Correctly rejected TypeScript");
        process.exit(0);
      }
    `,
    "typescript.js": `
      type Foo = string;
      const x: Foo = "test";
      module.exports = x;
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Wrapper 2");
  expect(stdout).toContain("Wrapper 1");
  expect(stdout).toContain("SUCCESS: Correctly rejected TypeScript");
});

test("Module._extensions override should handle .mjs and .cjs correctly", async () => {
  using dir = tempDir("module-extensions-mjs-cjs", {
    "index.js": `
      const Module = require("module");

      // Override .mjs and .cjs
      const origMJS = Module._extensions[".mjs"];
      const origCJS = Module._extensions[".cjs"] || Module._extensions[".js"];

      Module._extensions[".mjs"] = (m, f) => {
        console.log("Loading .mjs:", f);
        return origMJS(m, f);
      };

      Module._extensions[".cjs"] = (m, f) => {
        console.log("Loading .cjs:", f);
        return origCJS(m, f);
      };

      // .mjs with TypeScript should fail
      try {
        require("./typescript.mjs");
        console.log("ERROR: .mjs should reject TypeScript");
      } catch (err) {
        console.log("SUCCESS: .mjs rejected TypeScript");
      }

      // .cjs with TypeScript should fail
      try {
        require("./typescript.cjs");
        console.log("ERROR: .cjs should reject TypeScript");
      } catch (err) {
        console.log("SUCCESS: .cjs rejected TypeScript");
      }

      // Valid .mjs should work
      try {
        const mjs = require("./valid.mjs");
        console.log("SUCCESS: .mjs loaded:", mjs.type);
      } catch (err) {
        console.log("ERROR: Valid .mjs failed:", err.message);
      }
    `,
    "typescript.mjs": `
      const value: string = "typescript";
      export { value };
    `,
    "typescript.cjs": `
      const value: string = "typescript";
      module.exports = { value };
    `,
    "valid.mjs": `
      export const type = "mjs";
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS: .mjs rejected TypeScript");
  expect(stdout).toContain("SUCCESS: .cjs rejected TypeScript");
  expect(stdout).toContain("SUCCESS: .mjs loaded");
});

test("Module._extensions override should not affect JSON parsing", async () => {
  using dir = tempDir("module-extensions-json", {
    "index.js": `
      const Module = require("module");
      const origJSON = Module._extensions[".json"];

      Module._extensions[".json"] = (m, f) => {
        console.log("Loading JSON:", f);
        return origJSON(m, f);
      };

      // Should still parse as JSON, not JavaScript
      try {
        const data = require("./invalid-json.json");
        console.log("ERROR: Should have failed to parse invalid JSON");
        process.exit(1);
      } catch (err) {
        console.log("SUCCESS: Correctly failed on invalid JSON");
      }

      // Valid JSON should work
      const valid = require("./valid.json");
      console.log("Valid JSON loaded:", valid.test);
    `,
    "invalid-json.json": `
      // This is a comment, which is invalid in JSON
      { "test": "value" }
    `,
    "valid.json": `
      { "test": "passed" }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS: Correctly failed on invalid JSON");
  expect(stdout).toContain("Valid JSON loaded: passed");
  expect(stdout).toContain("Loading JSON:");
});
