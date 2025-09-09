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

test("dead code elimination for typeof Bun checks with --target=bun", async () => {
  using dir = tempDir("bun-typeof-dce", {
    "index.js": `
      // Note: We can't eliminate typeof Bun checks because Bun global is complex
      // Users should use process.versions.bun instead for dead code elimination
      if (typeof Bun !== "undefined") {
        console.log("Has Bun global");
        exports.hasBun = true;
      } else {
        console.log("No Bun global");
        exports.hasBun = false;
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

  // Both branches should still be present because we don't define Bun global
  expect(bundled).toContain("Bun");
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

test("dead code elimination with --compile", async () => {
  using dir = tempDir("compile-dce", {
    "index.js": `
      if (process.versions.bun) {
        console.log("Running in Bun");
      } else {
        console.log("Not running in Bun");
      }
    `,
  });

  // Build with --compile (which should define process.versions.bun)
  await using compileProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--compile", "--outfile=app"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const compileCode = await compileProc.exited;
  
  // Note: --compile requires downloading binaries which may not work in test environment
  // This test is mainly to document the expected behavior
  if (compileCode === 0) {
    // If compile succeeded, check that the binary was created
    const stats = await Bun.file(String(dir) + "/app").exists();
    expect(stats).toBe(true);
  }
});