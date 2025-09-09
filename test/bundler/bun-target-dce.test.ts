import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

test("--target=bun dead code elimination", async () => {
  using dir = tempDir("bun-target-dce", {
    "index.js": `
// ============ Direct Bun checks ============
if (Bun) {
  exports.test1 = "bun-exists";
} else {
  exports.test1 = "bun-missing";
  require("./should-not-import-1.js");
}

if (globalThis.Bun) {
  exports.test2 = "globalThis-bun-exists";
} else {
  exports.test2 = "globalThis-bun-missing";
  require("./should-not-import-2.js");
}

if (process.versions.bun) {
  exports.test3 = "process-versions-bun-exists";
} else {
  exports.test3 = "process-versions-bun-missing";
  require("./should-not-import-3.js");
}

// ============ typeof checks ============
if (typeof Bun !== "undefined") {
  exports.test4 = "typeof-bun-defined";
} else {
  exports.test4 = "typeof-bun-undefined";
  require("./should-not-import-4.js");
}

if (typeof globalThis.Bun !== "undefined") {
  exports.test5 = "typeof-globalThis-bun-defined";
} else {
  exports.test5 = "typeof-globalThis-bun-undefined";
}

// Reverse order
if ("undefined" === typeof Bun) {
  exports.test6 = "typeof-bun-reverse-undefined";
} else {
  exports.test6 = "typeof-bun-reverse-defined";
}

// ============ Property checks (should NOT trigger DCE) ============
if (Bun.version) {
  exports.test7 = "bun-version-exists";
} else {
  exports.test7 = "bun-version-missing";
}

if (Bun.doesntexist) {
  exports.test8 = "bun-fake-property-exists";
} else {
  exports.test8 = "bun-fake-property-missing";
}

// ============ Complex expressions ============
exports.test9 = process.versions.bun ? "ternary-bun" : "ternary-not-bun";
exports.test10 = !process.versions.bun ? "negated-not-bun" : "negated-bun";
exports.test11 = process.versions.bun && "and-bun";
exports.test12 = !process.versions.bun && "and-not-bun";
exports.test13 = process.versions.bun || "or-fallback";
exports.test14 = !process.versions.bun || "or-bun";

// ============ Mixed conditions ============
const runtimeVar = Math.random() > 0.5;
if (process.versions.bun && runtimeVar) {
  exports.test15 = "bun-and-runtime";
} else {
  exports.test15 = "not-bun-or-not-runtime";
}

if (!process.versions.bun && runtimeVar) {
  exports.test16 = "not-bun-and-runtime";
} else {
  exports.test16 = "bun-or-not-runtime";
}

// ============ Values preserved (not hardcoded) ============
exports.bunVersion = process.versions.bun;
exports.bunObject = Bun;
exports.platform = process.platform;
exports.arch = process.arch;

// ============ Non-Bun checks (preserved) ============
if (process.versions.node) {
  exports.test17 = "node-version-exists";
} else {
  exports.test17 = "node-version-missing";
}

if (typeof window !== "undefined") {
  exports.test18 = "window-exists";
} else {
  exports.test18 = "window-missing";
}

// ============ Const patterns (DCE doesn't work - needs constant propagation) ============
const isBun = typeof Bun !== "undefined";
if (!isBun) {
  exports.test19 = "const-not-bun";
} else {
  exports.test19 = "const-is-bun";
}
    `,
    "should-not-import-1.js": `exports.fail = "SHOULD_NOT_BE_IMPORTED_1";`,
    "should-not-import-2.js": `exports.fail = "SHOULD_NOT_BE_IMPORTED_2";`,
    "should-not-import-3.js": `exports.fail = "SHOULD_NOT_BE_IMPORTED_3";`,
    "should-not-import-4.js": `exports.fail = "SHOULD_NOT_BE_IMPORTED_4";`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js", "--minify-syntax"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(await proc.exited).toBe(0);
  const bundled = await Bun.file(String(dir) + "/bundle.js").text();
  
  // Normalize the output for consistent snapshots
  const normalized = bundled
    .replace(/require_[a-zA-Z0-9_]+/g, "require_HASH")
    .replace(/\/\/ .+\.js\n/g, "")  // Remove source file comments
    .split('\n')
    .filter(line => line.trim())  // Remove empty lines
    .join('\n');

  expect(normalized).toMatchInlineSnapshot(`
"// @bun
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_HASH = __commonJS((exports) => {
  Bun, exports.test1 = "bun-exists";
  globalThis.Bun, exports.test2 = "globalThis-bun-exists";
  process.versions.bun, exports.test3 = "process-versions-bun-exists";
  exports.test4 = "typeof-bun-defined";
  globalThis.Bun, exports.test5 = "typeof-globalThis-bun-defined";
  exports.test6 = "typeof-bun-reverse-defined";
  if (Bun.version)
    exports.test7 = "bun-version-exists";
  else
    exports.test7 = "bun-version-missing";
  if (Bun.doesntexist)
    exports.test8 = "bun-fake-property-exists";
  else
    exports.test8 = "bun-fake-property-missing";
  exports.test9 = (process.versions.bun, "ternary-bun");
  exports.test10 = "negated-bun";
  exports.test11 = process.versions.bun && "and-bun";
  exports.test12 = !1;
  exports.test13 = process.versions.bun;
  exports.test14 = "or-bun";
  var runtimeVar = Math.random() > 0.5;
  if (process.versions.bun && runtimeVar)
    exports.test15 = "bun-and-runtime";
  else
    exports.test15 = "not-bun-or-not-runtime";
  exports.test16 = "bun-or-not-runtime";
  exports.bunVersion = process.versions.bun;
  exports.bunObject = Bun;
  exports.platform = process.platform;
  exports.arch = process.arch;
  if (process.versions.node)
    exports.test17 = "node-version-exists";
  else
    exports.test17 = "node-version-missing";
  if (typeof window !== "undefined")
    exports.test18 = "window-exists";
  else
    exports.test18 = "window-missing";
  var isBun = typeof Bun !== "undefined";
  if (!isBun)
    exports.test19 = "const-not-bun";
  else
    exports.test19 = "const-is-bun";
});
export default require_HASH();"
`);

  // Key validations
  expect(bundled).not.toContain("SHOULD_NOT_BE_IMPORTED");
  expect(bundled).not.toContain("bun-missing");
  expect(bundled).not.toContain("globalThis-bun-missing");
  expect(bundled).not.toContain("process-versions-bun-missing");
  expect(bundled).not.toContain("typeof-bun-undefined");
  expect(bundled).not.toContain("ternary-not-bun");
  expect(bundled).not.toContain("negated-not-bun");
  expect(bundled).not.toContain("and-not-bun");
  expect(bundled).not.toContain("or-fallback");
  expect(bundled).not.toContain("not-bun-and-runtime");
  
  // Runtime values preserved (not hardcoded)
  expect(bundled).toContain("process.versions.bun");
  expect(bundled).toContain("process.platform");
  expect(bundled).toContain("process.arch");
  expect(bundled).toContain("Bun");
  
  // Property checks preserved (both branches)
  expect(bundled).toContain("bun-version-exists");
  expect(bundled).toContain("bun-version-missing");
  expect(bundled).toContain("bun-fake-property-exists");
  expect(bundled).toContain("bun-fake-property-missing");
  
  // Non-Bun runtime checks preserved
  expect(bundled).toContain("process.versions.node");
  expect(bundled).toContain("typeof window");
  
  // Const patterns don't work (needs constant propagation)
  expect(bundled).toContain("const-not-bun");
  expect(bundled).toContain("const-is-bun");
});

test("--target=bun vs --target=node comparison", async () => {
  const code = `
if (process.versions.bun) {
  exports.runtime = "bun";
} else if (process.versions.node) {
  exports.runtime = "node";
} else {
  exports.runtime = "unknown";
}

if (typeof Bun !== "undefined") {
  exports.hasBun = true;
} else {
  exports.hasBun = false;
}
  `;

  // Build for Bun
  using bunDir = tempDir("target-bun", { "index.js": code });
  await using bunProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=bun", "--outfile=bundle.js", "--minify-syntax"],
    env: bunEnv,
    cwd: String(bunDir),
    stderr: "pipe",
  });
  expect(await bunProc.exited).toBe(0);
  const bunBundle = await Bun.file(String(bunDir) + "/bundle.js").text();

  // Build for Node
  using nodeDir = tempDir("target-node", { "index.js": code });
  await using nodeProc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--target=node", "--outfile=bundle.js", "--minify-syntax"],
    env: bunEnv,
    cwd: String(nodeDir),
    stderr: "pipe",
  });
  expect(await nodeProc.exited).toBe(0);
  const nodeBundle = await Bun.file(String(nodeDir) + "/bundle.js").text();

  // Bun bundle should eliminate node/unknown branches
  expect(bunBundle).toContain('exports.runtime = "bun"');
  expect(bunBundle).not.toContain('exports.runtime = "node"');
  expect(bunBundle).not.toContain('exports.runtime = "unknown"');
  expect(bunBundle).toContain('exports.hasBun = !0'); // minified true
  expect(bunBundle).not.toContain('exports.hasBun = !1'); // minified false

  // Node bundle should keep all branches (Bun is unknown at runtime)
  expect(nodeBundle).toContain('exports.runtime = "bun"');
  expect(nodeBundle).toContain('exports.runtime = "node"');
  expect(nodeBundle).toContain('exports.runtime = "unknown"');
  expect(nodeBundle).toContain('exports.hasBun = !0'); // minified true
  expect(nodeBundle).toContain('exports.hasBun = !1'); // minified false
});