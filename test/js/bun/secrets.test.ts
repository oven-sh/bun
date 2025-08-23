import { spawnSync } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, isCI, isLinux, isMacOS } from "harness";
import { setupMacOSKeychain } from "./secrets-helpers.ts";

setupMacOSKeychain({ beforeAll, afterAll });

// Helper to determine if we should use unrestricted keychain access
// This is needed for macOS CI environments where user interaction is not available
function shouldUseUnrestrictedAccess(): boolean {
  return isMacOS && isCI;
}

// Helper to detect Ubuntu/Debian systems
function isUbuntuOrDebian(): boolean {
  if (!isLinux) return false;

  try {
    if (existsSync("/etc/os-release")) {
      const osRelease = readFileSync("/etc/os-release", "utf8");
      return osRelease.includes("ID=ubuntu") || osRelease.includes("ID=debian") || osRelease.includes("ID_LIKE=debian");
    }

    // Fallback: check for apt
    const result = spawnSync(["which", "apt"], { stderr: "ignore" });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// Helper to check if libsecret packages are available
function checkSecretsPackages(): boolean {
  try {
    const result = spawnSync(["pkg-config", "--exists", "libsecret-1"], { stderr: "ignore" });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// Helper to install required packages
function installSecretsPackages(): boolean {
  try {
    console.log("📦 Installing required packages for secrets API...");

    // Determine if we need sudo
    const needsSudo = process.getuid && process.getuid() !== 0;
    const aptCmd = needsSudo ? ["sudo", "apt-get"] : ["apt-get"];

    // Update package list
    const updateResult = spawnSync([...aptCmd, "update", "-qq"], {
      stderr: "ignore",
      env: { ...bunEnv, DEBIAN_FRONTEND: "noninteractive" },
    });

    if (updateResult.exitCode !== 0) {
      console.warn("⚠ Failed to update package list");
      return false;
    }

    // Install packages
    const installResult = spawnSync([...aptCmd, "install", "-y", "libsecret-1-dev", "gnome-keyring", "dbus-x11"], {
      stderr: "ignore",
      env: { ...bunEnv, DEBIAN_FRONTEND: "noninteractive" },
    });

    if (installResult.exitCode === 0) {
      console.log("✅ Packages installed successfully");
      return true;
    } else {
      console.warn("⚠ Failed to install packages");
      return false;
    }
  } catch (error) {
    console.warn("⚠ Error installing packages:", error);
    return false;
  }
}

// Helper to setup keyring environment
async function setupKeyringEnvironment(): Promise<boolean> {
  try {
    // Set up keyring directory
    const homeDir = process.env.HOME || process.env.USERPROFILE || "/root";
    const keyringsDir = `${homeDir}/.local/share/keyrings`;

    // Create directory
    spawnSync(["mkdir", "-p", keyringsDir], { stderr: "ignore" });

    // Create login keyring file
    const loginKeyring = `${keyringsDir}/login.keyring`;
    const keyringContent = `[keyring]
display-name=login
ctime=1609459200
mtime=1609459200
lock-on-idle=false
lock-after=false
`;

    await Bun.write(loginKeyring, keyringContent);

    // Set environment variables
    process.env.DISPLAY = process.env.DISPLAY || ":99";

    // Initialize keyring daemon
    const keyringResult = spawnSync(["sh", "-c", 'echo -n "" | gnome-keyring-daemon --daemonize --login'], {
      env: bunEnv,
      stderr: "ignore",
    });

    return keyringResult.exitCode === 0;
  } catch (error) {
    console.warn("⚠ Error during keyring setup:", error);
    return false;
  }
}

// Helper to spawn test in D-Bus session
function spawnTestInDbusSession(): never {
  console.log("🚌 Starting D-Bus session for secrets tests...");

  // Get the current Bun executable

  const testFile = import.meta.path;

  // Spawn in D-Bus session
  const result = spawnSync(["dbus-run-session", "--", bunExe(), "test", testFile], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: { ...bunEnv, BUN_SECRETS_DBUS_SESSION: "1" },
  });

  process.exit(result.exitCode || 0);
}

// Setup keyring environment for Linux CI
beforeAll(async () => {
  if (!isLinux) return;

  const needsSetup = isUbuntuOrDebian() && (isCI || process.env.FORCE_KEYRING_SETUP === "1");

  if (!needsSetup) return;

  // Check if we need to spawn in D-Bus session
  if (!process.env.DBUS_SESSION_BUS_ADDRESS && !process.env.BUN_SECRETS_DBUS_SESSION) {
    // Install packages first if needed
    if (!checkSecretsPackages()) {
      console.log("📦 Installing required packages for secrets API...");
      if (!installSecretsPackages()) {
        console.warn("⚠ Could not install required packages. Tests may fail.");
        console.warn("Manual install: apt-get install -y libsecret-1-dev gnome-keyring dbus-x11");
        return;
      }
    }

    // Setup keyring environment
    await setupKeyringEnvironment();

    // Restart in D-Bus session
    spawnTestInDbusSession();
  }

  // We're now in a D-Bus session, do final setup
  console.log("🔐 Finalizing keyring setup...");

  if (!(await setupKeyringEnvironment())) {
    console.warn("⚠ Keyring setup failed, tests may not work properly");
  } else {
    console.log("✅ Keyring environment ready");
    // Give keyring time to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
});

test("Bun.secrets API", async () => {
  const testService = "bun-test-service-" + Date.now();
  const testUser = "test-name-" + Math.random();
  const testPassword = "super-secret-value-123!@#";
  const updatedPassword = "new-value-456$%^";

  // Clean up any existing value first
  await Bun.secrets.delete({ service: testService, name: testUser });

  // Test 1: GET non-existent credential should return null
  {
    const result = await Bun.secrets.get({ service: testService, name: testUser });
    expect(result).toBeNull();
  }

  // Test 2: DELETE non-existent credential should return false
  {
    const result = await Bun.secrets.delete({ service: testService, name: testUser });
    expect(result).toBe(false);
  }

  // Test 3: SET new credential
  {
    await Bun.secrets.set({
      service: testService,
      name: testUser,
      value: testPassword,
      ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
    });
    const retrieved = await Bun.secrets.get({ service: testService, name: testUser });
    expect(retrieved).toBe(testPassword);
  }

  // Test 4: SET existing credential (should replace)
  {
    await Bun.secrets.set({
      service: testService,
      name: testUser,
      value: updatedPassword,
      ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
    });
    const retrieved = await Bun.secrets.get({ service: testService, name: testUser });
    expect(retrieved).toBe(updatedPassword);
    expect(retrieved).not.toBe(testPassword);
  }

  // Test 5: DELETE existing credential should return true
  {
    const result = await Bun.secrets.delete({ service: testService, name: testUser });
    expect(result).toBe(true);
  }

  // Test 6: GET after DELETE should return null
  {
    const result = await Bun.secrets.get({ service: testService, name: testUser });
    expect(result).toBeNull();
  }

  // Test 7: DELETE after DELETE should return false
  {
    const result = await Bun.secrets.delete({ service: testService, name: testUser });
    expect(result).toBe(false);
  }

  // Test 8: SET after DELETE should work
  {
    await Bun.secrets.set({
      service: testService,
      name: testUser,
      value: testPassword,
      ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
    });
    const retrieved = await Bun.secrets.get({ service: testService, name: testUser });
    expect(retrieved).toBe(testPassword);
  }

  // Test 9: Verify multiple operations work correctly
  {
    // Set, get, delete, verify cycle
    await Bun.secrets.set({
      service: testService,
      name: testUser,
      value: testPassword,
      ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
    });
    expect(await Bun.secrets.get({ service: testService, name: testUser })).toBe(testPassword);

    expect(await Bun.secrets.delete({ service: testService, name: testUser })).toBe(true);
    expect(await Bun.secrets.get({ service: testService, name: testUser })).toBeNull();
  }

  // Test 10: Empty string deletes credential
  {
    // Set a credential first
    await Bun.secrets.set({
      service: testService,
      name: testUser,
      value: testPassword,
      ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
    });
    expect(await Bun.secrets.get({ service: testService, name: testUser })).toBe(testPassword);

    // Empty string should delete it
    await Bun.secrets.set({
      service: testService,
      name: testUser,
      value: "",
      ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
    });
    expect(await Bun.secrets.get({ service: testService, name: testUser })).toBeNull();

    // Empty string on non-existent credential should not error
    await Bun.secrets.set({
      service: testService + "-empty",
      name: testUser,
      value: "",
      ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
    });
    expect(await Bun.secrets.get({ service: testService + "-empty", name: testUser })).toBeNull();
  }

  // Clean up
  await Bun.secrets.delete({ service: testService, name: testUser });
});

test("Bun.secrets error handling", async () => {
  // Test invalid arguments

  // Test 1: GET with missing options
  try {
    // @ts-expect-error - testing invalid input
    await Bun.secrets.get();
    expect.unreachable("Should have thrown");
  } catch (error) {
    expect(error.message).toContain("secrets.get requires an options object");
  }

  // Test 2: GET with non-object options
  try {
    // @ts-expect-error - testing invalid input
    await Bun.secrets.get("not an object");
    expect.unreachable("Should have thrown");
  } catch (error) {
    expect(error.message).toContain("Expected options to be an object");
  }

  // Test 3: GET with missing service
  try {
    // @ts-expect-error - testing invalid input
    await Bun.secrets.get({ name: "test" });
    expect.unreachable("Should have thrown");
  } catch (error) {
    expect(error.message).toContain("Expected service and name to be strings");
  }

  // Test 4: GET with missing name
  try {
    // @ts-expect-error - testing invalid input
    await Bun.secrets.get({ service: "test" });
    expect.unreachable("Should have thrown");
  } catch (error) {
    expect(error.message).toContain("Expected service and name to be strings");
  }

  // Test 5: SET with missing value
  try {
    // @ts-expect-error - testing invalid input
    await Bun.secrets.set({ service: "test", name: "test" });
    // This should work without error - just needs a value
    // But if it does work, the value will be undefined which is an error
  } catch (error) {
    expect(error.message).toContain("Expected 'value' to be a string");
  }

  // Test 6: SET with non-string value (not null/undefined)
  try {
    // @ts-expect-error - testing invalid input
    await Bun.secrets.set({ service: "test", name: "test", value: 123 });
    expect.unreachable("Should have thrown");
  } catch (error) {
    expect(error.message).toContain("Expected 'value' to be a string");
  }

  // Test 7: DELETE with missing options
  try {
    // @ts-expect-error - testing invalid input
    await Bun.secrets.delete();
    expect.unreachable("Should have thrown");
  } catch (error) {
    expect(error.message).toContain("requires an options object");
  }
});

test("Bun.secrets handles empty strings as delete", async () => {
  const testService = "bun-test-empty-" + Date.now();
  const testUser = "test-name-empty";

  // First, set a real credential
  await Bun.secrets.set({
    service: testService,
    name: testUser,
    value: "test-password",
    ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
  });
  let result = await Bun.secrets.get({ service: testService, name: testUser });
  expect(result).toBe("test-password");

  // Test that empty string deletes the credential
  await Bun.secrets.set({
    service: testService,
    name: testUser,
    value: "",
    ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
  });
  result = await Bun.secrets.get({ service: testService, name: testUser });
  expect(result).toBeNull(); // Should be null since credential was deleted

  // Test that setting empty string on non-existent credential doesn't error
  await Bun.secrets.set({
    service: testService + "-nonexistent",
    name: testUser,
    value: "",
    ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
  });
  result = await Bun.secrets.get({ service: testService + "-nonexistent", name: testUser });
  expect(result).toBeNull();
});

test("Bun.secrets handles special characters", async () => {
  const testService = "bun-test-special-" + Date.now();
  const testUser = "name@example.com";
  const testPassword = "p@$$w0rd!#$%^&*()_+-=[]{}|;':\",./<>?`~\n\t\r";

  await Bun.secrets.set({
    service: testService,
    name: testUser,
    value: testPassword,
    ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
  });
  const result = await Bun.secrets.get({ service: testService, name: testUser });
  expect(result).toBe(testPassword);

  // Clean up
  await Bun.secrets.delete({ service: testService, name: testUser });
});

test("Bun.secrets handles unicode", async () => {
  const testService = "bun-test-unicode-" + Date.now();
  const testUser = "用户";
  const testPassword = "密码🔒🔑 emoji and 中文";

  await Bun.secrets.set({
    service: testService,
    name: testUser,
    value: testPassword,
    ...(shouldUseUnrestrictedAccess() && { allowUnrestrictedAccess: true }),
  });
  const result = await Bun.secrets.get({ service: testService, name: testUser });
  expect(result).toBe(testPassword);

  // Clean up
  await Bun.secrets.delete({ service: testService, name: testUser });
});

test("Bun.secrets handles concurrent operations", async () => {
  const promises: Promise<void>[] = [];
  const count = 10;

  // Create multiple credentials concurrently
  for (let i = 0; i < count; i++) {
    const service = `bun-concurrent-${Date.now()}-${i}`;
    const name = `name-${i}`;
    const value = `value-${i}`;

    promises.push(
      Bun.secrets
        .set({ service, name, value: value })
        .then(() => Bun.secrets.get({ service, name }))
        .then(retrieved => {
          expect(retrieved).toBe(value);
          return Bun.secrets.delete({ service, name });
        })
        .then(deleted => {
          expect(deleted).toBe(true);
        }),
    );
  }

  await Promise.all(promises);
});
