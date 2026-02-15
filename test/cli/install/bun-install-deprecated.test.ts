import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { join } from "path";
import { mkdir, writeFile, rm } from "fs/promises";

test("bun install respects deprecated field", async () => {
  const cwd = join(import.meta.dir, "bun-install-deprecated-" + Date.now());
  await mkdir(cwd, { recursive: true });

  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      dependencies: {
        // Use semver range to mirror the original issue:
        // Stable releases 1.0.0-1.0.3 are deprecated, but prerelease 1.0.0-beta.5 is not
        // ^1.0.0 should select the non-deprecated prerelease over deprecated stable releases
        "@mastra/deployer": "^1.0.0",
      },
    })
  );

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
  });

  expect(exitCode).toBe(0);

  // Check installed version of @mastra/server
  const serverPkgJsonPath = join(cwd, "node_modules", "@mastra", "server", "package.json");
  const serverPkgJson = await Bun.file(serverPkgJsonPath).json();

  console.log("Installed @mastra/server version:", serverPkgJson.version);

  // Should NOT be 1.0.3 (which is deprecated)
  expect(serverPkgJson.version).not.toBe("1.0.3");
  
  // Should be 1.0.0-beta.5 or similar non-deprecated version
  // We can't strictly assert 1.0.0-beta.5 because newer versions might be released,
  // but we know 1.0.3 is the problematic deprecated one.
  // However, based on the issue, 1.0.0-beta.5 is the expected one for that specific deployer version.
  expect(serverPkgJson.version).toBe("1.0.0-beta.5");

  await rm(cwd, { recursive: true, force: true });
}, 60000); // Increase timeout for network operations
