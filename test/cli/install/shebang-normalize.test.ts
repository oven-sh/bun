import { spawn } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, runBunInstall, tmpdirSync } from "harness";
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
