import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import fs from "node:fs";
import { dirname, join } from "node:path";

// Non-CI debug builds hot-reload builtin JS from `<buildDir>/js`
// (BUN_DYNAMIC_JS_LOAD_PATH) so `src/js` edits apply without relinking. Those
// files bake in codegen-assigned numeric IDs ($lazy native-call IDs, internal
// module registry indices, error-code IDs), so a file written by a different
// codegen run than the one the binary was built from can dispatch to the wrong
// native binding. Each file carries a trailing `@bun-internal-module-generation`
// stamp that the loader checks; a mismatch must fail with an actionable error
// instead of loading misnumbered code.
//
// Only dev debug builds read the hot-reload dir. Codegen writes `<buildDir>/js`
// for release builds too, so gate on the build flavor as well as the dir; CI
// debug builds and USE_SYSTEM_BUN have no dir next to the binary and skip.
const jsDir = join(dirname(bunExe()), "js");
const osJsPath = join(jsDir, "node", "os.js");
const hasDynamicJS = isDebug && fs.existsSync(osJsPath);

const SKEW_MESSAGE = "different codegen generation";

async function requireOsInChild() {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const os = require('node:os'); console.log(typeof os.freemem)"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.skipIf(!hasDynamicJS)("builtin JS hot-reload generation guard", () => {
  test("a file from a different codegen generation is rejected with an actionable error", async () => {
    const original = fs.readFileSync(osJsPath);
    try {
      let tampered = original.toString("latin1");
      // Simulate a codegen run that renumbered native-call IDs: shift the os
      // binding's $lazy ID by one (dispatches to a different native function)
      // and stamp the file as belonging to another generation.
      tampered = tampered.replace(/bound\(@lazy\((\d+)\)\)/, (_, id) => `bound(@lazy(${Number(id) + 1}))`);
      tampered = tampered.replace(/(@bun-internal-module-generation=)[0-9a-f]+/, "$1" + "0".repeat(16));
      expect(tampered).not.toBe(original.toString("latin1"));
      fs.writeFileSync(osJsPath, tampered, "latin1");

      const { stdout, stderr, exitCode } = await requireOsInChild();
      expect(stderr).toContain(SKEW_MESSAGE);
      expect(stdout).not.toContain("function");
      expect(exitCode).not.toBe(0);
    } finally {
      fs.writeFileSync(osJsPath, original);
    }
  });

  test("an edited file with an intact generation stamp still hot-reloads", async () => {
    const original = fs.readFileSync(osJsPath);
    try {
      const marker = "BUN_DEV_RELOAD_MARKER_1b2d";
      const edited = original.toString("latin1").replace('"use strict";', `"use strict";console.error("${marker}");`);
      expect(edited).not.toBe(original.toString("latin1"));
      fs.writeFileSync(osJsPath, edited, "latin1");

      const { stdout, stderr, exitCode } = await requireOsInChild();
      expect(stderr).toContain(marker);
      expect(stdout).toContain("function");
      expect(exitCode).toBe(0);
    } finally {
      fs.writeFileSync(osJsPath, original);
    }
  });

  test("a valid stamp that is not the final line does not count", async () => {
    const original = fs.readFileSync(osJsPath);
    try {
      // The valid stamp becomes a decoy: a foreign stamp follows it as the
      // real last line, as if a different codegen run appended to the file.
      const foreignStamp = "// @bun-internal-module-generation=" + "0".repeat(16) + "\n";
      fs.writeFileSync(osJsPath, Buffer.concat([original, Buffer.from(foreignStamp, "latin1")]));

      const { stdout, stderr, exitCode } = await requireOsInChild();
      expect(stderr).toContain(SKEW_MESSAGE);
      expect(stdout).not.toContain("function");
      expect(exitCode).not.toBe(0);
    } finally {
      fs.writeFileSync(osJsPath, original);
    }
  });

  test("a truncated file (codegen mid-write) is rejected, not misparsed", async () => {
    const original = fs.readFileSync(osJsPath);
    try {
      // A partially-written file has no trailing generation stamp yet.
      fs.writeFileSync(osJsPath, original.subarray(0, Math.floor(original.length / 2)));

      const { stdout, stderr, exitCode } = await requireOsInChild();
      expect(stderr).toContain(SKEW_MESSAGE);
      expect(stdout).not.toContain("function");
      expect(exitCode).not.toBe(0);
    } finally {
      fs.writeFileSync(osJsPath, original);
    }
  });
});

// Keep the file non-empty for runners without hot-reload support.
test.skipIf(hasDynamicJS)("builtin JS hot-reload not supported by this build", () => {
  expect(hasDynamicJS).toBe(false);
});
