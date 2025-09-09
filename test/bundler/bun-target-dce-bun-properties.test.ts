import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

test("DCE handles Bun object properties correctly", async () => {
  using dir = tempDir("dce-bun-properties", {
    "index.js": `
      // Bun.version should work normally (it exists)
      if (Bun.version) {
        exports.test1 = "has-version";
      } else {
        exports.test1 = "no-version";
      }
      
      // Bun.doesntexist should NOT trigger DCE (property doesn't exist)
      if (Bun.doesntexist) {
        exports.test2 = "has-fake-property";
      } else {
        exports.test2 = "no-fake-property";
      }
      
      // Bun.somethingUndefined should also not trigger DCE
      if (Bun.somethingUndefined) {
        exports.test3 = "has-undefined";
      } else {
        exports.test3 = "no-undefined";
      }
      
      // Direct Bun check should still work
      if (Bun) {
        exports.test4 = "has-bun";
      } else {
        exports.test4 = "no-bun";
      }
      
      // Complex property checks
      if (Bun && Bun.version) {
        exports.test5 = "bun-and-version";
      } else {
        exports.test5 = "no-bun-or-version";
      }
      
      // Bun.main should work (it's a real property)
      if (Bun.main) {
        exports.test6 = "has-main";
      } else {
        exports.test6 = "no-main";
      }
      
      // Store actual values to verify they're not replaced
      exports.bunVersion = Bun.version;
      exports.bunObject = Bun;
      exports.bunFake = Bun.doesntexist;
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

  // Bun.version - real property, both branches should be kept (runtime check)
  expect(bundled).toContain("has-version");
  expect(bundled).toContain("no-version");
  
  // Bun.doesntexist - fake property, both branches should be kept
  expect(bundled).toContain("has-fake-property");
  expect(bundled).toContain("no-fake-property");
  
  // Bun.somethingUndefined - fake property, both branches should be kept
  expect(bundled).toContain("has-undefined");
  expect(bundled).toContain("no-undefined");
  
  // Direct Bun check - only true branch should remain
  expect(bundled).toContain("has-bun");
  expect(bundled).not.toContain('"no-bun"'); // Check for the actual string literal
  
  // Complex check - both branches kept (depends on runtime Bun.version)
  expect(bundled).toContain("bun-and-version");
  expect(bundled).toContain("no-bun-or-version");
  
  // Bun.main - real property, both branches kept
  expect(bundled).toContain("has-main");
  expect(bundled).toContain("no-main");
  
  // Values should be preserved
  expect(bundled).toContain("exports.bunVersion = Bun.version");
  expect(bundled).toContain("exports.bunObject = Bun");
  expect(bundled).toContain("exports.bunFake = Bun.doesntexist");
});

test("DCE only applies to Bun object itself, not its properties", async () => {
  using dir = tempDir("dce-bun-object-only", {
    "index.js": `
      // These should trigger DCE (Bun object exists)
      const test1 = Bun ? "bun-exists" : "bun-missing";
      const test2 = globalThis.Bun ? "global-bun-exists" : "global-bun-missing";
      const test3 = typeof Bun !== "undefined" ? "typeof-bun-exists" : "typeof-bun-missing";
      
      // These should NOT trigger DCE (property checks)
      const test4 = Bun.version ? "version-exists" : "version-missing";
      const test5 = Bun.doesntexist ? "fake-exists" : "fake-missing";
      const test6 = Bun.env ? "env-exists" : "env-missing";
      const test7 = Bun.argv ? "argv-exists" : "argv-missing";
      
      // Even real properties should be runtime checks
      const test8 = Bun.which ? "which-exists" : "which-missing";
      const test9 = Bun.spawn ? "spawn-exists" : "spawn-missing";
      
      exports.results = {
        test1, test2, test3, test4, test5, test6, test7, test8, test9
      };
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

  // Bun object checks - only true branches remain
  expect(bundled).toContain("bun-exists");
  expect(bundled).not.toContain("bun-missing");
  expect(bundled).toContain("global-bun-exists");
  expect(bundled).not.toContain("global-bun-missing");
  expect(bundled).toContain("typeof-bun-exists");
  expect(bundled).not.toContain("typeof-bun-missing");
  
  // Property checks - both branches remain (runtime checks)
  expect(bundled).toContain("version-exists");
  expect(bundled).toContain("version-missing");
  expect(bundled).toContain("fake-exists");
  expect(bundled).toContain("fake-missing");
  expect(bundled).toContain("env-exists");
  expect(bundled).toContain("env-missing");
  expect(bundled).toContain("argv-exists");
  expect(bundled).toContain("argv-missing");
  expect(bundled).toContain("which-exists");
  expect(bundled).toContain("which-missing");
  expect(bundled).toContain("spawn-exists");
  expect(bundled).toContain("spawn-missing");
});

test("typeof checks on Bun properties don't trigger DCE", async () => {
  using dir = tempDir("dce-typeof-bun-props", {
    "index.js": `
      // typeof Bun triggers DCE
      if (typeof Bun !== "undefined") {
        exports.test1 = "bun-defined";
      } else {
        exports.test1 = "bun-undefined";
      }
      
      // typeof Bun.version does NOT trigger DCE
      if (typeof Bun.version !== "undefined") {
        exports.test2 = "version-defined";
      } else {
        exports.test2 = "version-undefined";
      }
      
      // typeof Bun.doesntexist does NOT trigger DCE
      if (typeof Bun.doesntexist !== "undefined") {
        exports.test3 = "fake-defined";
      } else {
        exports.test3 = "fake-undefined";
      }
      
      // Complex typeof on property
      if (typeof Bun.spawn === "function") {
        exports.test4 = "spawn-is-function";
      } else {
        exports.test4 = "spawn-not-function";
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

  // typeof Bun - DCE applies
  expect(bundled).toContain("bun-defined");
  expect(bundled).not.toContain("bun-undefined");
  
  // typeof Bun properties - no DCE
  expect(bundled).toContain("version-defined");
  expect(bundled).toContain("version-undefined");
  expect(bundled).toContain("fake-defined");
  expect(bundled).toContain("fake-undefined");
  expect(bundled).toContain("spawn-is-function");
  expect(bundled).toContain("spawn-not-function");
});

test("DCE limitation: const patterns don't trigger DCE (constant propagation not implemented)", async () => {
  using dir = tempDir("dce-const-limitation", {
    "index.js": `
      // These patterns currently DO NOT trigger DCE
      // because constant propagation is not implemented
      
      const isBun = typeof Bun !== "undefined";
      if (!isBun) {
        exports.test1 = "not-bun-const";
      } else {
        exports.test1 = "is-bun-const";
      }
      
      const hasBun = !!process.versions.bun;
      if (hasBun) {
        exports.test2 = "has-bun-const";
      } else {
        exports.test2 = "no-bun-const";
      }
      
      // Direct checks DO trigger DCE (for comparison)
      if (typeof Bun !== "undefined") {
        exports.test3 = "bun-direct";
      } else {
        exports.test3 = "not-bun-direct";
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

  // Const patterns - both branches remain (limitation)
  expect(bundled).toContain("not-bun-const");
  expect(bundled).toContain("is-bun-const");
  expect(bundled).toContain("has-bun-const");
  expect(bundled).toContain("no-bun-const");
  
  // Direct pattern - DCE works
  expect(bundled).toContain("bun-direct");
  expect(bundled).not.toContain("not-bun-direct");
  
  // This is a known limitation - constant propagation would be needed
  // to make const patterns work with DCE
});