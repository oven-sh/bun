import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

setDefaultTimeout(60000);

test("--no-bin-links prevents creation of symlinks in node_modules/.bin", async () => {
  // https://github.com/oven-sh/bun/issues/24628
  // Create temp directory with test package that has a bin
  using dir = tempDir("no-bin-links-test", {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: {
        typescript: "5.7.2",
      },
    }),
  });

  // Run bun install with --no-bin-links flag
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-bin-links"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "inherit",
    stdout: "inherit",
  });

  const exitCode = await proc.exited;

  // Installation should succeed
  expect(exitCode).toBe(0);

  // Check that typescript was installed
  const typescriptDir = join(String(dir), "node_modules", "typescript");
  expect(existsSync(typescriptDir)).toBe(true);

  // Check that node_modules/.bin does NOT exist or is empty
  const binDir = join(String(dir), "node_modules", ".bin");
  const binDirExists = existsSync(binDir);

  if (binDirExists) {
    // If .bin exists, it should be empty or not contain typescript bins
    const binContents = readdirSync(binDir);
    expect(binContents).not.toContain("tsc");
    expect(binContents).not.toContain("tsserver");
  } else {
    // .bin directory should not exist at all
    expect(binDirExists).toBe(false);
  }
});

test("without --no-bin-links, bin links are created normally", async () => {
  // Create temp directory with test package that has a bin
  using dir = tempDir("with-bin-links-test", {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: {
        typescript: "5.7.2",
      },
    }),
  });

  // Run bun install WITHOUT --no-bin-links flag
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "inherit",
    stdout: "inherit",
  });

  const exitCode = await proc.exited;

  // Installation should succeed
  expect(exitCode).toBe(0);

  // Check that typescript was installed
  const typescriptDir = join(String(dir), "node_modules", "typescript");
  expect(existsSync(typescriptDir)).toBe(true);

  // Check that node_modules/.bin exists and contains the bins
  const binDir = join(String(dir), "node_modules", ".bin");
  expect(existsSync(binDir)).toBe(true);

  const binContents = readdirSync(binDir);
  expect(binContents).toContain("tsc");
  expect(binContents).toContain("tsserver");
});
