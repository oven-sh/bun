import { spawn } from "bun";
import { expect, test } from "bun:test";
import { chmodSync, readFileSync } from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { bunEnv, bunExe, isPosix, isWindows, runBunInstall, tempDirWithFiles, tmpdirSync } from "harness";
import { join } from "path";

const env = bunEnv;

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

// https://github.com/oven-sh/bun/issues/31387
//
// `bun install` of a package whose bin uses `#!/usr/bin/env -S <prog> <args>`
// (e.g. `ocx@2.0.11`: `#!/usr/bin/env -S bun --no-env-file`) used to produce a
// broken Windows shim — `BinLinkingShim::parse` treated `-S` as the
// interpreter program, so the generated `.bunx` file launched
// `-S bun --no-env-file <target>` and `bun_shim_impl.exe` failed with
// `interpreter executable "-S" not found in %PATH%`. On POSIX the kernel (via
// `env`) splits `-S` natively and the bin just runs.

function makeEnvDashSFixture() {
  return tempDirWithFiles("shebang-env-s", {
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
    // `--no-env-file` is a real Bun flag, so if the shim hands it to Bun the
    // process starts cleanly and we see the log line below.
    "env-dash-s-pkg/dist/index.js": `#!/usr/bin/env -S bun --no-env-file
console.log("env-S-shebang-ok");
`,
  });
}

test("bun install handles `#!/usr/bin/env -S bun ...` shebangs in bin scripts", async () => {
  const dir = makeEnvDashSFixture();
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

test.skipIf(!isWindows)("Windows `.bunx` shim encodes `env -S` launcher without the -S flag", async () => {
  const dir = makeEnvDashSFixture();
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
