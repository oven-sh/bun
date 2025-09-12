import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, isWindows } from "harness";
import { join } from "path";

test("bun install should read registry from ~/.npmrc", async () => {
  // Skip on Windows as npmrc path is different
  if (isWindows) {
    test.skip();
    return;
  }

  using testDir = tempDir("npmrc-home", {
    "package.json": JSON.stringify({
      name: "test-npmrc-home",
      version: "1.0.0",
      dependencies: {
        "fake-package": "1.0.0"
      }
    }),
    "home": {
      ".npmrc": "registry=https://custom.registry.example.com/\n"
    }
  });
  
  const fakeHome = join(String(testDir), "home");

  // Run bun install with HOME pointing to our fake home
  // The install should fail trying to reach the custom registry
  const result = await Bun.spawn({
    cmd: [bunExe(), "install"],
    env: {
      ...bunEnv,
      HOME: fakeHome,
      // Clear XDG_CONFIG_HOME to ensure HOME is used
      XDG_CONFIG_HOME: undefined,
    },
    cwd: String(testDir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    result.stdout.text(),
    result.stderr.text(),
  ]);

  const exitCode = await result.exited;

  // The install should fail because it tries to reach our custom registry
  // If ~/.npmrc was properly read, it would try to fetch from custom.registry.example.com
  // and fail with a network error
  expect(stderr).toContain("custom.registry.example.com");
  
  // Currently this test will FAIL because bun doesn't read ~/.npmrc
  // Once the bug is fixed, this test should PASS
});

test("bun install should read cache directory from ~/.npmrc", async () => {
  // Skip on Windows as npmrc path is different
  if (isWindows) {
    test.skip();
    return;
  }

  using testDir = tempDir("npmrc-cache", {
    "package.json": JSON.stringify({
      name: "test-npmrc-cache",
      version: "1.0.0"
    }),
    "home": {
      ".npmrc": ""  // Will be written after we know the path
    },
    "custom-cache": {}  // Create empty dir
  });
  
  const fakeHome = join(String(testDir), "home");
  const customCache = join(String(testDir), "custom-cache");
  
  // Write the npmrc with the actual cache path
  await Bun.write(join(fakeHome, ".npmrc"), `cache=${customCache}\n`);

  // Run bun install with HOME pointing to our fake home and verbose mode
  const result = await Bun.spawn({
    cmd: [bunExe(), "install"],
    env: {
      ...bunEnv,
      HOME: fakeHome,
      XDG_CONFIG_HOME: undefined,
      BUN_INSTALL_VERBOSE: "1",
    },
    cwd: String(testDir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await result.stderr.text();
  await result.exited;

  // Check if the custom cache directory from ~/.npmrc is being used
  // Currently this will FAIL because bun doesn't read ~/.npmrc
  expect(stderr).toContain(`Cache Dir: ${customCache}`);
});

test("local .npmrc should override ~/.npmrc", async () => {
  // Skip on Windows as npmrc path is different  
  if (isWindows) {
    test.skip();
    return;
  }

  using testDir = tempDir("npmrc-override", {
    "package.json": JSON.stringify({
      name: "test-npmrc-override",
      version: "1.0.0",
      dependencies: {
        "fake-package": "1.0.0"
      }
    }),
    ".npmrc": "registry=https://local.registry.example.com/\n",
    "home": {
      ".npmrc": "registry=https://home.registry.example.com/\n"
    }
  });
  
  const fakeHome = join(String(testDir), "home");

  // Run bun install
  const result = await Bun.spawn({
    cmd: [bunExe(), "install"],
    env: {
      ...bunEnv,
      HOME: fakeHome,
      XDG_CONFIG_HOME: undefined,
    },
    cwd: String(testDir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await result.stderr.text();
  await result.exited;

  // The local .npmrc should take precedence
  expect(stderr).toContain("local.registry.example.com");
  expect(stderr).not.toContain("home.registry.example.com");
});