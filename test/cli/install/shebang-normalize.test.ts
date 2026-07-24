import { spawn } from "bun";
import * as internalForTesting from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, runBunInstall, tempDirWithFiles, tmpdirSync } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/31387
// `BinLinkingShim::parse` only runs on Windows during `bun install`; drive it
// via the testing binding (namespace import so an absent binding fails the test).
test.each([
  ["#!/usr/bin/env -S bun --no-env-file\n", "bun --no-env-file", true],
  ["#!/usr/bin/env -S node --experimental-vm-modules\n", "node --experimental-vm-modules", true],
  ["#!/usr/bin/env -S python3 -u\n", "python3 -u", false],
  ["#!/usr/bin/env -Sbun --no-env-file\n", "bun --no-env-file", true],
  ["#!/usr/bin/env bun\n", "bun", true],
  ["#!/bin/env -S bun --flag\n", "bun --flag", true],
])("parseBinShebang(%j) strips env -S and keeps the real interpreter", (contents, launcher, isNodeOrBun) => {
  expect(typeof internalForTesting.parseBinShebang).toBe("function");
  expect(internalForTesting.parseBinShebang(contents, "index.js")).toEqual({ launcher, isNodeOrBun });
});

test.skipIf(isWindows)("bin linking normalizes CRLF in shebang", async () => {
  const testDir = tmpdirSync();
  const pkgDir = join(testDir, "pkg");
  const consumerDir = join(testDir, "consumer");

  await mkdir(pkgDir, { recursive: true });
  await mkdir(consumerDir, { recursive: true });

  // Create package with bin that has CRLF shebang
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "test-pkg-crlf",
      version: "1.0.0",
      bin: {
        "test-bin": "test-bin.py",
      },
    }),
  );

  // Write bin file with CRLF shebang
  await writeFile(join(pkgDir, "test-bin.py"), "#!/usr/bin/env python\r\nprint('hello from python')");

  // Link the package
  const linkResult = spawn({
    cmd: [bunExe(), "link"],
    cwd: pkgDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  await linkResult.exited;
  expect(linkResult.exitCode).toBe(0);

  // Create consumer package
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify({
      name: "consumer",
      version: "1.0.0",
      dependencies: {
        "test-pkg-crlf": "link:test-pkg-crlf",
      },
    }),
  );

  // Install
  await runBunInstall(env, consumerDir);

  // Check that the linked bin file has normalized shebang
  const binPath = join(consumerDir, "node_modules", "test-pkg-crlf", "test-bin.py");
  const binContent = await readFile(binPath, "utf-8");

  console.log("Bin content first 50 chars:", JSON.stringify(binContent.slice(0, 50)));

  expect(binContent).toStartWith("#!/usr/bin/env python\nprint");
  expect(binContent).not.toContain("\r\n");

  // Verify that the file is executable (bin linking sets this)
  const binStat = await stat(binPath);
  expect(binStat.mode & 0o111).toBeGreaterThan(0); // At least one execute bit should be set
});

// `.bunx` file format (little-endian throughout):
//   [WSTR:bin_path] [u16 '"'] [u16 0]
//   (if shebang: [WSTR:launcher_with_trailing_space] [u32 bin_path_byte_len] [u32 args_byte_len])
//   [u16 flags]
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
  return bytes.subarray(launcherStart, launcherEnd - 2).toString("utf16le");
}

// https://github.com/oven-sh/bun/issues/31387
// Windows shim must skip `env -S` so the real interpreter becomes the launcher.
test.skipIf(!isWindows)("Windows `.bunx` shim encodes `env -S` launcher without the -S flag", async () => {
  const dir = tempDirWithFiles("shebang-env-s", {
    "consumer/package.json": JSON.stringify({
      name: "consumer",
      version: "1.0.0",
      dependencies: { "env-dash-s-pkg": "file:../env-dash-s-pkg" },
    }),
    "env-dash-s-pkg/package.json": JSON.stringify({
      name: "env-dash-s-pkg",
      version: "1.0.0",
      bin: { "env-dash-s-pkg": "./dist/index.js" },
    }),
    // Only the shebang line feeds the `.bunx` encoder; the body is never run.
    "env-dash-s-pkg/dist/index.js": "#!/usr/bin/env -S bun --no-env-file\n",
  });
  const consumer = join(dir, "consumer");

  await using install = spawn({
    cmd: [bunExe(), "install"],
    cwd: consumer,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, installStderr, installExit] = await Promise.all([
    install.stdout.text(),
    install.stderr.text(),
    install.exited,
  ]);
  expect(installStderr).not.toContain("error");
  expect(installExit).toBe(0);

  const bunxPath = join(consumer, "node_modules", ".bin", "env-dash-s-pkg.bunx");
  const bytes = readFileSync(bunxPath);
  const launcher = decodeBunxLauncher(bytes);

  expect(launcher.startsWith("-S")).toBe(false);
  expect(launcher).toBe("bun --no-env-file");
});
