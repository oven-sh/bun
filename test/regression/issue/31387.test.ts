// https://github.com/oven-sh/bun/issues/31387
//
// `bun install` of a package whose bin uses `#!/usr/bin/env -S <prog> <args>`
// (e.g. `ocx@2.0.11`: `#!/usr/bin/env -S bun --no-env-file`) used to produce a
// broken Windows shim — the parser in `BinLinkingShim::parse` treated `-S` as
// the interpreter program, so the generated `.bunx` file launched
// `-S bun --no-env-file <target>` and bun_shim_impl.exe failed with:
//
//   error: interpreter executable "-S" not found in %PATH%
//
// The regression coverage runs in two shapes:
//
//   1. Cross-platform — install a local package whose bin has an `env -S`
//      shebang, then invoke the installed bin through `bun run`. On POSIX
//      the kernel (via `env`) splits the args; on Windows the `.bunx` shim
//      must do it. Either way the bin must execute successfully.
//
//   2. Windows-only — decode the generated `.bunx` file directly and confirm
//      the encoded launcher starts with `bun`, not `-S`. This is the tight
//      regression test for the shim parser itself.

import { spawn } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isPosix, isWindows, tempDirWithFiles } from "harness";
import { chmodSync } from "node:fs";
import { join } from "path";

function makeFixture() {
  return tempDirWithFiles("issue-31387", {
    "consumer/package.json": JSON.stringify({
      name: "consumer",
      version: "1.0.0",
      dependencies: {
        "env-dash-s-pkg": "file:../env-dash-s-pkg",
      },
    }),
    "env-dash-s-pkg/package.json": JSON.stringify({
      name: "env-dash-s-pkg",
      version: "1.0.0",
      bin: {
        "env-dash-s-pkg": "./dist/index.js",
      },
    }),
    // The shebang Bun previously mis-parsed on Windows. `--no-env-file` is a
    // real Bun flag, so if the shim hands it to Bun we get a clean run.
    "env-dash-s-pkg/dist/index.js": `#!/usr/bin/env -S bun --no-env-file
console.log("env-S-shebang-ok");
`,
  });
}

test("bun install handles `#!/usr/bin/env -S bun ...` shebangs in bin scripts", async () => {
  const dir = makeFixture();
  const consumer = join(dir, "consumer");

  if (isPosix) {
    // `env -S` only runs natively through the file's execute bit.
    chmodSync(join(dir, "env-dash-s-pkg/dist/index.js"), 0o755);
  }

  await using install = spawn({
    cmd: [bunExe(), "install"],
    cwd: consumer,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [installStderr, installExit] = await Promise.all([install.stderr.text(), install.exited]);
  expect(installStderr).not.toContain("error");
  expect(installExit).toBe(0);

  // Invoke the installed bin through `bun run`. On Windows this goes through
  // the generated `.bunx` shim — which is exactly the code path the fix
  // changes. Previously this would fail with
  // `interpreter executable "-S" not found in %PATH%`.
  await using run = spawn({
    cmd: [bunExe(), "run", "env-dash-s-pkg"],
    cwd: consumer,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(stderr).not.toContain("interpreter executable");
  expect(stdout).toContain("env-S-shebang-ok");
  expect(exit).toBe(0);
});

// `.bunx` file format (little-endian throughout):
//   [WSTR:bin_path] [u16 '"'] [u16 0] (if shebang: [WSTR:launcher_with_trailing_space] [u32 bin_path_byte_len] [u32 args_byte_len]) [u16 flags]
//
// Decode just enough to read the launcher, then assert it does not begin
// with `-S`. See `src/install/windows-shim/BinLinkingShim.rs` for the
// authoritative encoder.
function decodeBunxLauncher(bytes: Buffer): string {
  expect(bytes.length).toBeGreaterThanOrEqual(2 + 4 + 4 + 2);
  const flags = bytes.readUInt16LE(bytes.length - 2);
  const hasShebang = (flags & 0b100) !== 0;
  expect(hasShebang).toBe(true);

  const argsByteLen = bytes.readUInt32LE(bytes.length - 2 - 4);
  // `args_byte_len` includes the trailing " " the encoder appends (+2 bytes in UTF-16).
  // The launcher bytes sit immediately before the two u32 trailers.
  const launcherEnd = bytes.length - 2 - 8;
  const launcherStart = launcherEnd - argsByteLen;
  expect(launcherStart).toBeGreaterThanOrEqual(0);

  // Drop the trailing space the encoder writes so we compare against the raw launcher.
  const launcher = bytes.subarray(launcherStart, launcherEnd - 2).toString("utf16le");
  return launcher;
}

test.skipIf(!isWindows)("Windows `.bunx` shim encodes `env -S` launcher without the -S flag", async () => {
  const dir = makeFixture();
  const consumer = join(dir, "consumer");

  await using install = spawn({
    cmd: [bunExe(), "install"],
    cwd: consumer,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await install.exited).toBe(0);

  const bunxPath = join(consumer, "node_modules", ".bin", "env-dash-s-pkg.bunx");
  const bytes = readFileSync(bunxPath);
  const launcher = decodeBunxLauncher(bytes);

  // Before the fix this was "-S bun --no-env-file"; after the fix the `-S`
  // is stripped and the real interpreter leads.
  expect(launcher.startsWith("-S")).toBe(false);
  expect(launcher).toBe("bun --no-env-file");
});
