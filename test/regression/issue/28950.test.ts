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
    // Decoy that matches the basename of the scoped package. If the fast
    // path of bunx searches PATH for "collide" it will find this and run it.
    "decoy/collide": `#!/bin/sh
echo "DECOY_RAN"
`,
    // Windows .cmd equivalent for the decoy — on Windows bun.which looks up
    // common extensions when searching PATH.
    "decoy/collide.cmd": `@echo off\r\necho DECOY_RAN\r\n`,
  });

  const root = String(dir);
  const realJs = join(root, "node_modules/@myscope/collide/real.js");
  const realBin = join(root, "node_modules/.bin/real-bin");
  const decoy = join(root, "decoy/collide");

  if (!isWindows) {
    chmodSync(realJs, 0o755);
    chmodSync(realBin, 0o755);
    chmodSync(decoy, 0o755);
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The fix: `bun x @myscope/collide` must NOT run the decoy named "collide"
  // on PATH — it must resolve through the scoped package's package.json to
  // the real bin "real-bin".
  expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
    stdout: "REAL_BIN_RAN",
    stderr: "",
    exitCode: 0,
  });
});
