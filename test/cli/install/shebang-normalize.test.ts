import { spawn } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, runBunInstall, tempDir, tmpdirSync } from "harness";
import { join } from "path";

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

test.skipIf(!isWindows)("bin linking reports a shebang launcher that is not valid UTF-8", async () => {
  using dir = tempDir("shebang-invalid-utf8", {
    "pkg/package.json": JSON.stringify({
      name: "shebang-pkg",
      version: "1.0.0",
      bin: { "shebang-bin": "shebang-bin.js" },
    }),
    "app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { "shebang-pkg": "file:../pkg" },
    }),
  });

  await writeFile(
    join(String(dir), "pkg", "shebang-bin.js"),
    Buffer.concat([Buffer.from("#!/usr/bin/env n"), Buffer.from([0x80, 0x80]), Buffer.from("\nconsole.log(1)\n")]),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(String(dir), "app"),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("failed to link");
  expect(stderr).toContain("InvalidBinContent");
  expect(await Bun.file(join(String(dir), "app", "node_modules", "shebang-pkg", "package.json")).exists()).toBe(true);
  expect(exitCode).toBe(1);
});

// `.bunx`, little-endian (src/install/windows-shim/BinLinkingShim.rs):
//   [WSTR bin_path] [u16 '"'] [u16 0] [WSTR launcher + ' '] [u32 bin_path bytes] [u32 launcher bytes] [u16 flags]
function launcherOf(bunx: Buffer): string {
  const hasShebang = (bunx.readUInt16LE(bunx.length - 2) & 0b100) !== 0;
  expect(hasShebang).toBe(true);
  const launcherEnd = bunx.length - 2 - 8;
  const launcherBytes = bunx.readUInt32LE(bunx.length - 2 - 4);
  // Without the space after it.
  return bunx.subarray(launcherEnd - launcherBytes, launcherEnd - 2).toString("utf16le");
}

// https://github.com/oven-sh/bun/issues/22422
test.skipIf(!isWindows).each([
  ["#!/usr/bin/env -S bun --no-env-file", "bun --no-env-file"],
  ["#!/usr/bin/env -Snode --experimental-vm-modules", "node --experimental-vm-modules"],
  ["#!/bin/env  -S  python3 -u", "python3 -u"],
  ["#!/usr/bin/env node", "node"],
])("the launcher of %j is %j", async (shebang, launcher) => {
  using dir = tempDir("shebang-env-s", {
    "pkg/package.json": JSON.stringify({ name: "shebang-pkg", version: "1.0.0", bin: { "shebang-bin": "cli.js" } }),
    "pkg/cli.js": `${shebang}\n`,
    "app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { "shebang-pkg": "file:../pkg" },
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(String(dir), "app"),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error:");
  expect(launcherOf(await readFile(join(String(dir), "app", "node_modules", ".bin", "shebang-bin.bunx")))).toBe(
    launcher,
  );
  expect(exitCode).toBe(0);
});
