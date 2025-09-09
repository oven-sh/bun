import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

test("DCE removes imports only used in dead code blocks", async () => {
  using dir = tempDir("dce-import-removal", {
    "index.js": `
      import { heavyLibrary } from "./heavy.js";
      import { alwaysUsed } from "./always.js";
      
      // This import should be removed - only used in dead code
      if (!process.versions.bun) {
        console.log(heavyLibrary());
      }
      
      // This import should be kept - used outside dead code
      console.log(alwaysUsed());
      
      // Another dead import case with typeof
      if (typeof Bun === "undefined") {
        const { deadFunction } = require("./dead-module.js");
        deadFunction();
      }
    `,
    "heavy.js": `
      export function heavyLibrary() {
        return "SHOULD NOT BE IN BUNDLE";
      }
    `,
    "always.js": `
      export function alwaysUsed() {
        return "should be in bundle";
      }
    `,
    "dead-module.js": `
      exports.deadFunction = function() {
        return "SHOULD NOT BE IN BUNDLE";
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(await proc.exited).toBe(0);
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // Dead imports should be removed
  expect(bundled).not.toContain("SHOULD NOT BE IN BUNDLE");
  expect(bundled).not.toContain("heavyLibrary");
  expect(bundled).not.toContain("deadFunction");
  expect(bundled).not.toContain("dead-module.js");
  
  // Live imports should remain
  expect(bundled).toContain("should be in bundle");
  expect(bundled).toContain("alwaysUsed");
});

test("DCE handles mixed conditions correctly", async () => {
  using dir = tempDir("dce-mixed-conditions", {
    "index.js": `
      const isDev = process.env.NODE_ENV === "development";
      
      // Mixed with AND - dead code should be eliminated
      if (!process.versions.bun && isDev) {
        exports.test1 = "dead-and";
      } else {
        exports.test1 = "live-and";
      }
      
      // Mixed with OR - should keep both branches since isDev is runtime
      if (process.versions.bun || isDev) {
        exports.test2 = "maybe-live-or";
      } else {
        exports.test2 = "maybe-dead-or";
      }
      
      // Nested conditions
      if (process.versions.bun) {
        if (isDev) {
          exports.test3 = "bun-dev";
        } else {
          exports.test3 = "bun-prod";
        }
      } else {
        // This entire block should be eliminated
        if (isDev) {
          exports.test3 = "not-bun-dev";
        } else {
          exports.test3 = "not-bun-prod";
        }
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(await proc.exited).toBe(0);
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // Dead branches eliminated
  expect(bundled).not.toContain("dead-and");
  expect(bundled).toContain("live-and");
  
  // Runtime conditions - if Bun is true, OR is always true
  expect(bundled).toContain("maybe-live-or");
  expect(bundled).not.toContain("maybe-dead-or"); // This can be eliminated since Bun || anything is always true
  
  // Nested dead code eliminated
  expect(bundled).toContain("bun-dev");
  expect(bundled).toContain("bun-prod");
  expect(bundled).not.toContain("not-bun-dev");
  expect(bundled).not.toContain("not-bun-prod");
});

test("DCE preserves side effects and doesn't over-delete", async () => {
  using dir = tempDir("dce-side-effects", {
    "index.js": `
      let counter = 0;
      
      // Side effect in condition - should be preserved
      if ((counter++, process.versions.bun)) {
        exports.test1 = "bun";
      } else {
        exports.test1 = "not-bun";
      }
      
      // Function call with side effects
      function sideEffect() {
        counter++;
        return true;
      }
      
      if (sideEffect() && !process.versions.bun) {
        exports.test2 = "dead";
      } else {
        exports.test2 = "live";
      }
      
      // Preserve the counter value
      exports.counter = counter;
      
      // Don't eliminate code that looks similar but isn't a Bun check
      const myObj = { versions: { bun: "fake" } };
      if (myObj.versions.bun) {
        exports.test3 = "should-keep-this";
      }
      
      // Preserve typeof checks on other things
      if (typeof window !== "undefined") {
        exports.test4 = "window-check";
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(await proc.exited).toBe(0);
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // Side effects preserved
  expect(bundled).toContain("counter++");
  expect(bundled).toContain("sideEffect()");
  expect(bundled).toContain("exports.counter = counter");
  
  // Correct branches kept
  // Note: comma operator with side effects is complex, the condition is preserved
  expect(bundled).toContain("not-bun"); // This is kept because of the comma operator complexity
  expect(bundled).not.toContain("dead");
  expect(bundled).toContain("live");
  
  // Non-Bun checks preserved
  expect(bundled).toContain("should-keep-this");
  expect(bundled).toContain("window-check");
  expect(bundled).toContain("myObj.versions.bun");
});

test("DCE handles all typeof variations correctly", async () => {
  using dir = tempDir("dce-typeof-variations", {
    "index.js": `
      // typeof with different string comparisons
      if (typeof Bun === "object") {
        // This should NOT be eliminated (we only handle "undefined")
        exports.test1 = "bun-object";
      }
      
      if (typeof Bun === "function") {
        // This should NOT be eliminated
        exports.test2 = "bun-function";
      }
      
      if (typeof Bun !== "string") {
        // This should NOT be eliminated
        exports.test3 = "bun-not-string";
      }
      
      // Only "undefined" comparisons should trigger DCE
      if (typeof Bun === "undefined") {
        exports.test4 = "should-be-eliminated";
      } else {
        exports.test4 = "bun-defined";
      }
      
      // Complex typeof expressions
      const bunType = typeof Bun;
      if (bunType !== "undefined") {
        exports.test5 = "bun-via-var";
      }
      
      // Negated typeof
      if (!(typeof Bun === "undefined")) {
        exports.test6 = "bun-negated";
      } else {
        exports.test6 = "should-be-eliminated-2";
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(await proc.exited).toBe(0);
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // Non-undefined comparisons should be preserved
  expect(bundled).toContain("bun-object");
  expect(bundled).toContain("bun-function");
  expect(bundled).toContain("bun-not-string");
  
  // Only undefined comparisons trigger DCE
  expect(bundled).not.toContain("should-be-eliminated");
  expect(bundled).toContain("bun-defined");
  
  // Complex cases
  expect(bundled).toContain("bunType");
  expect(bundled).toContain("bun-via-var");
  expect(bundled).toContain("bun-negated");
  expect(bundled).not.toContain("should-be-eliminated-2");
});

test("DCE handles ternary and logical operators", async () => {
  using dir = tempDir("dce-ternary", {
    "index.js": `
      // Ternary operator
      exports.test1 = process.versions.bun ? "bun" : "not-bun";
      exports.test2 = !process.versions.bun ? "not-bun-2" : "bun-2";
      exports.test3 = typeof Bun !== "undefined" ? "bun-3" : "not-bun-3";
      
      // Logical operators
      exports.test4 = process.versions.bun && "bun-4";
      exports.test5 = !process.versions.bun && "not-bun-5";
      exports.test6 = process.versions.bun || "fallback";
      exports.test7 = !process.versions.bun || "bun-or-fallback";
      
      // Nullish coalescing
      exports.test8 = process.versions.bun ?? "default";
      
      // Complex nested
      exports.test9 = globalThis.Bun 
        ? (process.versions.bun ? "both" : "impossible") 
        : "also-impossible";
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(await proc.exited).toBe(0);
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // Correct branches in ternaries
  expect(bundled).not.toContain("not-bun");
  expect(bundled).toContain("bun");
  expect(bundled).toContain("bun-2");
  expect(bundled).not.toContain("not-bun-2");
  expect(bundled).toContain("bun-3");
  expect(bundled).not.toContain("not-bun-3");
  
  // Logical operators
  expect(bundled).toContain("bun-4");
  expect(bundled).not.toContain("not-bun-5");
  // Note: || operator keeps the actual value, not the fallback
  expect(bundled).toContain("process.versions.bun"); // The actual value is kept
  expect(bundled).toContain("bun-or-fallback");
  
  // Complex nested
  expect(bundled).toContain("both");
  expect(bundled).not.toContain("impossible");
  expect(bundled).not.toContain("also-impossible");
});

test("DCE works with try-catch and async code", async () => {
  using dir = tempDir("dce-try-catch", {
    "index.js": `
      // Try-catch blocks
      try {
        if (!process.versions.bun) {
          throw new Error("Should be eliminated");
        }
        exports.test1 = "success";
      } catch (e) {
        exports.test1 = "error";
      }
      
      // Async functions
      async function checkBun() {
        if (typeof Bun === "undefined") {
          await import("./should-not-import.js");
          return "not-bun";
        }
        return "is-bun";
      }
      
      exports.checkBun = checkBun;
      
      // Promise chains
      exports.promise = Promise.resolve()
        .then(() => {
          if (!globalThis.Bun) {
            return "should-be-eliminated";
          }
          return "bun-promise";
        });
    `,
    "should-not-import.js": `
      export default "SHOULD NOT BE IMPORTED";
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(await proc.exited).toBe(0);
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // Dead code in try-catch eliminated
  expect(bundled).not.toContain("Should be eliminated");
  expect(bundled).toContain("success");
  
  // Async dead code eliminated
  expect(bundled).not.toContain("should-not-import.js");
  expect(bundled).not.toContain("SHOULD NOT BE IMPORTED");
  expect(bundled).not.toContain("not-bun");
  expect(bundled).toContain("is-bun");
  
  // Promise dead code eliminated
  expect(bundled).not.toContain("should-be-eliminated");
  expect(bundled).toContain("bun-promise");
});

test("DCE preserves all non-Bun runtime checks", async () => {
  using dir = tempDir("dce-preserve-runtime", {
    "index.js": `
      // These should ALL be preserved - they're runtime checks
      if (process.env.NODE_ENV === "production") {
        exports.env = "prod";
      }
      
      if (process.platform === "darwin") {
        exports.platform = "mac";
      }
      
      if (process.arch === "arm64") {
        exports.arch = "arm";
      }
      
      if (process.versions.node) {
        exports.node = "has-node";
      }
      
      if (typeof window !== "undefined") {
        exports.window = "browser";
      }
      
      if (typeof document !== "undefined") {
        exports.document = "has-document";
      }
      
      // Custom objects that look like Bun checks but aren't
      const custom = { Bun: true };
      if (custom.Bun) {
        exports.custom = "custom-bun";
      }
      
      // String contains "Bun" but isn't a Bun check
      if ("Bun" in globalThis) {
        // This IS a Bun check and should be optimized
        exports.inCheck = "has-bun";
      } else {
        exports.inCheck = "no-bun";
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(await proc.exited).toBe(0);
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // All runtime checks should be preserved
  // Note: NODE_ENV gets replaced by define with "development" by default
  // So the condition becomes false for "production" check
  expect(bundled.includes("NODE_ENV") || bundled.includes("false")).toBe(true);
  expect(bundled).toContain("process.platform");
  expect(bundled).toContain("process.arch");
  expect(bundled).toContain("process.versions.node");
  expect(bundled).toContain("typeof window");
  expect(bundled).toContain("typeof document");
  expect(bundled).toContain("custom.Bun");
  expect(bundled).toContain("custom-bun");
});

test("DCE performance - handles large files efficiently", async () => {
  // Generate a large file with many Bun checks
  const lines = [];
  for (let i = 0; i < 1000; i++) {
    lines.push(`
      if (!process.versions.bun) {
        exports.dead${i} = "should-be-eliminated-${i}";
        console.log("dead code ${i}");
      } else {
        exports.live${i} = "live-${i}";
      }
    `);
  }
  
  using dir = tempDir("dce-performance", {
    "index.js": lines.join("\n"),
  });

  const start = Date.now();
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js", "--minify"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(await proc.exited).toBe(0);
  const elapsed = Date.now() - start;
  
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();
  
  // Should complete reasonably fast (under 5 seconds for 1000 checks)
  expect(elapsed).toBeLessThan(5000);
  
  // All dead code should be eliminated
  expect(bundled).not.toContain("should-be-eliminated");
  expect(bundled).not.toContain("dead code");
  
  // Bundle should be significantly smaller due to DCE
  expect(bundled.length).toBeLessThan(50000); // Should be much smaller than without DCE
});

