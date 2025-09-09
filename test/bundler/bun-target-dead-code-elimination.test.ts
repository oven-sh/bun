import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

test("dead code elimination for process.versions.bun with --target=bun", async () => {
  using dir = tempDir("bun-target-dce", {
    "index.js": `
      if (process.versions.bun) {
        console.log("Running in Bun");
        exports.runtime = "bun";
      } else {
        console.log("Not running in Bun");
        exports.runtime = "node";
      }
      
      // This should be eliminated when target=bun
      if (!process.versions.bun) {
        console.log("This should be eliminated in Bun builds");
        require("fs").writeFileSync("should-not-exist.txt", "fail");
      }
      
      // Check process.browser too
      if (process.browser) {
        exports.isBrowser = true;
      } else {
        exports.isServer = true;
      }
    `,
  });

  // Build with --target=bun
  await using bundleProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [bundleOut, bundleErr, bundleCode] = await Promise.all([
    bundleProc.stdout.text(),
    bundleProc.stderr.text(),
    bundleProc.exited,
  ]);

  expect(bundleCode).toBe(0);
  expect(bundleErr).toBe("");

  // Read the bundled output
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // The bundled code should not contain the "Not running in Bun" branch
  expect(bundled).not.toContain("Not running in Bun");
  expect(bundled).not.toContain("should-not-exist.txt");
  expect(bundled).not.toContain("This should be eliminated");

  // The bundled code should contain the "Running in Bun" branch
  expect(bundled).toContain("Running in Bun");
  expect(bundled).toContain("runtime");
  expect(bundled).toContain("bun");

  // process.browser should be false for bun target
  expect(bundled).toContain("isServer");
  expect(bundled).not.toContain("isBrowser");
});

test("dead code elimination for all Bun detection patterns with --target=bun", async () => {
  using dir = tempDir("bun-all-patterns-dce", {
    "index.js": `
      // Test 1: Direct Bun global checks
      if (Bun) {
        exports.test1 = "bun-direct";
      } else {
        exports.test1 = "not-bun-direct";
        require("fs").writeFileSync("direct-fail.txt", "should not exist");
      }
      
      // Test 2: globalThis.Bun checks
      if (globalThis.Bun) {
        exports.test2 = "bun-globalThis";
      } else {
        exports.test2 = "not-bun-globalThis";
        require("fs").writeFileSync("globalThis-fail.txt", "should not exist");
      }
      
      // Test 3: process.versions.bun checks
      if (process.versions.bun) {
        exports.test3 = "bun-versions";
      } else {
        exports.test3 = "not-bun-versions";
        require("fs").writeFileSync("versions-fail.txt", "should not exist");
      }
      
      // Test 4: Verify actual values are preserved (not replaced with constants)
      exports.bunVersion = process.versions.bun;
      exports.bunGlobal = Bun;
      exports.bunGlobalThis = globalThis.Bun;
    `,
  });

  // Build with --target=bun
  await using bundleProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [bundleOut, bundleErr, bundleCode] = await Promise.all([
    bundleProc.stdout.text(),
    bundleProc.stderr.text(),
    bundleProc.exited,
  ]);

  expect(bundleCode).toBe(0);
  expect(bundleErr).toBe("");

  // Read the bundled output
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // All "not-bun" branches should be eliminated
  expect(bundled).not.toContain("not-bun-direct");
  expect(bundled).not.toContain("not-bun-globalThis");
  expect(bundled).not.toContain("not-bun-versions");
  
  // None of the fail files should be referenced
  expect(bundled).not.toContain("direct-fail.txt");
  expect(bundled).not.toContain("globalThis-fail.txt");
  expect(bundled).not.toContain("versions-fail.txt");

  // The "bun" branches should remain
  expect(bundled).toContain("bun-direct");
  expect(bundled).toContain("bun-globalThis");
  expect(bundled).toContain("bun-versions");
  
  // The actual values should still be referenced (not replaced with constants)
  expect(bundled).toContain("exports.bunVersion = process.versions.bun");
  expect(bundled).toContain("exports.bunGlobal = Bun");
  expect(bundled).toContain("exports.bunGlobalThis = globalThis.Bun");
});

test("compare dead code elimination: --target=bun vs --target=node", async () => {
  using dir = tempDir("bun-vs-node-dce", {
    "index.js": `
      if (process.versions.bun) {
        exports.runtime = "bun";
      } else if (process.versions.node) {
        exports.runtime = "node";
      } else {
        exports.runtime = "browser";
      }
    `,
  });

  // Build with --target=bun
  await using bunProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bun-bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const bunCode = await bunProc.exited;
  expect(bunCode).toBe(0);

  // Build with --target=node
  await using nodeProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=node", "--outfile=node-bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const nodeCode = await nodeProc.exited;
  expect(nodeCode).toBe(0);

  const bunBundle = await Bun.file(String(dir) + "/bun-bundle.js").text();
  const nodeBundle = await Bun.file(String(dir) + "/node-bundle.js").text();

  // Bun bundle should only have "bun" runtime, the node branch should be eliminated
  expect(bunBundle).toContain("exports.runtime = \"bun\"");
  expect(bunBundle).not.toContain("exports.runtime = \"node\"");
  expect(bunBundle).not.toContain("exports.runtime = \"browser\"");

  // Node bundle should check for both (since process.versions.bun is not defined for node target)
  expect(nodeBundle).toContain("process.versions.bun");
  expect(nodeBundle).toContain("process.versions.node");
});

test("--target=bun does not hardcode runtime values", async () => {
  using dir = tempDir("bun-no-hardcode", {
    "index.js": `
      // These values should NOT be replaced with constants
      exports.platform = process.platform;
      exports.arch = process.arch;
      exports.bunVersion = process.versions.bun;
      exports.nodeVersion = process.versions.node;
      exports.bunObject = Bun;
      
      // But DCE should still work for conditionals
      if (!process.versions.bun) {
        exports.shouldNotExist = "this should be eliminated";
      }
    `,
  });

  // Build with --target=bun
  await using bundleProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const bundleCode = await bundleProc.exited;
  expect(bundleCode).toBe(0);

  const bundled = await Bun.file(String(dir) + "/bundle.js").text();

  // Values should be preserved, not replaced with constants
  // Check that the actual runtime values are used (not hardcoded strings)
  expect(bundled).toContain("process.platform");
  expect(bundled).toContain("process.arch");
  expect(bundled).toContain("process.versions.bun");
  expect(bundled).toContain("Bun");
  
  // But DCE should still eliminate dead code
  expect(bundled).not.toContain("shouldNotExist");
  expect(bundled).not.toContain("this should be eliminated");
});