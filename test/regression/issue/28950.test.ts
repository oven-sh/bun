// https://github.com/oven-sh/bun/issues/28950
//
// `bun x @scope/name` must not fall through to a same-named system command
// when the scoped package publishes a bin with a different name. Previously
// we would derive `initial_bin_name` from the basename after `/` and
// happily resolve it against $PATH, so e.g. `bun x @paretools/git` ran
// `/usr/bin/git` instead of `pare-git`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

test("bun x @scope/name runs the package's real bin, not a colliding system command", async () => {
  // The scoped package's "basename" (`collide`) intentionally matches the
  // decoy binary we'll put on PATH. The real bin is `real-bin`.
  //
  // Pre-install it under the scoped path and populate `node_modules/.bin`
  // manually — `--no-install` makes `bun x` use what's already on disk, so
  // this is enough to exercise the code path without talking to a registry.
  using dir = tempDir("bunx-28950-", {
    "node_modules/@myscope/collide/package.json": JSON.stringify({
      name: "@myscope/collide",
      version: "1.0.0",
      bin: { "real-bin": "./real.js" },
    }),
    "node_modules/@myscope/collide/real.js": `#!/usr/bin/env node
console.log("REAL_BIN_RAN");
`,
    "node_modules/.bin/real-bin": `#!/usr/bin/env node
require("../@myscope/collide/real.js");
`,
    // Windows .cmd shim for the real bin — on Windows `bun.which` only matches
    // files with .exe/.cmd/.bat extensions, so the extension-less shebang script
    // above is invisible to it.
    "node_modules/.bin/real-bin.cmd": `@echo off\r\nnode "%~dp0..\\@myscope\\collide\\real.js" %*\r\n`,
    // Decoy that matches the basename of the scoped package. If the fast
    // path of bunx searches PATH for "collide" it will find this and run it.
    "decoy/collide": `#!/bin/sh
echo "DECOY_RAN"
`,
    // Windows .cmd equivalent for the decoy.
    "decoy/collide.cmd": `@echo off\r\necho DECOY_RAN\r\n`,
  });

  const root = String(dir);

  if (!isWindows) {
    chmodSync(join(root, "node_modules/@myscope/collide/real.js"), 0o755);
    chmodSync(join(root, "node_modules/.bin/real-bin"), 0o755);
    chmodSync(join(root, "decoy/collide"), 0o755);
  }

  // Prepend the decoy dir to PATH so `bun.which("collide")` would hit it
  // before any real system command.
  const PATH = join(root, "decoy") + (isWindows ? ";" : ":") + (bunEnv.PATH ?? "");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "x", "--no-install", "@myscope/collide"],
    cwd: root,
    env: { ...bunEnv, PATH },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The fix: `bun x @myscope/collide` must NOT run the decoy named "collide"
  // on PATH — it must resolve through the scoped package's package.json to
  // the real bin "real-bin". (Don't assert stderr is empty — ASAN builds
  // emit warnings there even on success.)
  expect(stdout.trim()).toBe("REAL_BIN_RAN");
  expect(exitCode).toBe(0);
});

test("bun x @scope/name runs an already-installed bin whose name matches the basename", async () => {
  // Regression for the double-skip case: if `@scope/foo` publishes a bin
  // literally named `foo` (bin name == package basename), the fix for the
  // main issue still needs to re-probe $PATH for the resolved bin name,
  // even though it matches `initial_bin_name`. Otherwise the first probe
  // is skipped (because the package is scoped) *and* the second probe is
  // skipped (because the names match) — leaving a locally-installed bin
  // undiscoverable under `--no-install`.
  using dir = tempDir("bunx-28950-match-", {
    "node_modules/@myscope/samebin/package.json": JSON.stringify({
      name: "@myscope/samebin",
      version: "1.0.0",
      bin: { samebin: "./real.js" },
    }),
    "node_modules/@myscope/samebin/real.js": `#!/usr/bin/env node
console.log("SAMEBIN_RAN");
`,
    "node_modules/.bin/samebin": `#!/usr/bin/env node
require("../@myscope/samebin/real.js");
`,
    "node_modules/.bin/samebin.cmd": `@echo off\r\nnode "%~dp0..\\@myscope\\samebin\\real.js" %*\r\n`,
  });

  const root = String(dir);

  if (!isWindows) {
    chmodSync(join(root, "node_modules/@myscope/samebin/real.js"), 0o755);
    chmodSync(join(root, "node_modules/.bin/samebin"), 0o755);
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "x", "--no-install", "@myscope/samebin"],
    cwd: root,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("SAMEBIN_RAN");
  expect(exitCode).toBe(0);
});
