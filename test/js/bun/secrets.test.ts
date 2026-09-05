import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, isCI, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { copyFileSync } from "node:fs";
import { join } from "node:path";

// Helper to determine if we should use unrestricted keychain access
// This is needed for macOS CI environments where user interaction is not available
function shouldUseUnrestrictedAccess(): boolean {
  return isMacOS && isCI;
}

// Setup keyring environment for Linux CI

test.todoIf(isCI && !isWindows)("Bun.secrets API", async () => {
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

test.todoIf(isCI && !isWindows)("Bun.secrets error handling", async () => {
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

test.todoIf(isCI && !isWindows)("Bun.secrets handles empty strings as delete", async () => {
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

test.todoIf(isCI && !isWindows)("Bun.secrets handles special characters", async () => {
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

test.todoIf(isCI && !isWindows)("Bun.secrets handles unicode", async () => {
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

test.todoIf(isCI && !isWindows)("Bun.secrets handles concurrent operations", async () => {
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

describe("Bun.secrets timeout option", () => {
  test("rejects values the deadline cannot honor", () => {
    const cases: [unknown, string][] = [
      [-1, "ERR_OUT_OF_RANGE"],
      [1.5, "ERR_OUT_OF_RANGE"],
      [NaN, "ERR_OUT_OF_RANGE"],
      [-Infinity, "ERR_OUT_OF_RANGE"],
      ["100", "ERR_INVALID_ARG_TYPE"],
      [true, "ERR_INVALID_ARG_TYPE"],
    ];
    for (const [timeout, code] of cases) {
      let thrown: any;
      try {
        // @ts-expect-error - testing invalid input
        Bun.secrets.get({ service: "bun-test", name: "timeout", timeout });
      } catch (error) {
        thrown = error;
      }
      expect(thrown?.code, `timeout: ${timeout}`).toBe(code);
      expect(thrown.message).toContain("options.timeout");
    }
  });
});

// SecretsLinux.cpp dlopens GLib, GObject, GIO and libsecret by soname, so one
// stub library copied under those four names into a directory on
// LD_LIBRARY_PATH stands in for the whole stack: a keyring daemon that never
// answers, with no GLib installed. Needs a C compiler.
const stubSonames = ["libglib-2.0.so.0", "libgobject-2.0.so.0", "libgio-2.0.so.0", "libsecret-1.so.0"];

describe.skipIf(!isLinux || !(Bun.which("cc") || Bun.which("clang") || Bun.which("gcc")))(
  "Bun.secrets with a stalled Secret Service",
  () => {
    let libDir: ReturnType<typeof tempDir>;

    beforeAll(() => {
      libDir = tempDir("bun-secrets-stub", {});
      const stub = compileFixture(join(import.meta.dir, "secrets-stub", "libsecret-stub.c"));
      for (const soname of stubSonames) {
        copyFileSync(stub, join(String(libDir), soname));
      }
    });
    afterAll(() => libDir[Symbol.dispose]());

    function stubEnv(mode: "hang" | "never" | "return") {
      return { ...bunEnv, LD_LIBRARY_PATH: String(libDir), BUN_SECRETS_STUB_MODE: mode };
    }

    // A build without the deadline never exits these children, and a test
    // that times out cannot dispose of them. The unref'd timer does not hold
    // the loop open, so a passing run never reaches it.
    const watchdog = `setTimeout(() => process.exit(99), 15_000).unref();`;

    test.concurrent("a fire-and-forget call does not keep the process alive past its deadline", async () => {
      // The stub ignores the cancel, so only the released loop ref lets the
      // process exit. That is the normal exit path. The leak-checking teardown
      // the ASAN runner turns on (BUN_DESTRUCT_VM_ON_EXIT) waits for every
      // pool thread by design and would wait on this one forever.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `${watchdog}
           Bun.secrets.get({ service: "s", name: "n", timeout: 100 }).catch(e => console.log(e.code));
           console.log("script end");`,
        ],
        env: { ...stubEnv("never"), BUN_DESTRUCT_VM_ON_EXIT: undefined },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("script end\nERR_SECRETS_TIMEOUT\n");
      expect(stderr).toContain("[stub] lookup mode=never cancellable=yes");
      expect(exitCode).toBe(0);
    });

    test.concurrent("get, set and delete reject with ERR_SECRETS_TIMEOUT at the deadline", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `${watchdog}
           const results = await Promise.allSettled([
             Bun.secrets.get({ service: "s", name: "n", timeout: 100 }),
             Bun.secrets.set({ service: "s", name: "n", value: "v", timeout: 100 }),
             Bun.secrets.delete({ service: "s", name: "n", timeout: 100 }),
           ]);
           console.log(JSON.stringify(results.map(r => r.status === "rejected" ? [r.reason.code, r.reason.message] : r.value)));`,
        ],
        env: stubEnv("hang"),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stdout)).toEqual([
        ["ERR_SECRETS_TIMEOUT", "secrets.get timed out after 100ms waiting for the system credential store"],
        ["ERR_SECRETS_TIMEOUT", "secrets.set timed out after 100ms waiting for the system credential store"],
        ["ERR_SECRETS_TIMEOUT", "secrets.delete timed out after 100ms waiting for the system credential store"],
      ]);
      expect(stderr).toContain("[stub] lookup mode=hang cancellable=yes");
      expect(stderr).toContain("[stub] store mode=hang cancellable=yes");
      expect(stderr).toContain("[stub] clear mode=hang cancellable=yes");
      expect(exitCode).toBe(0);
    });

    test.concurrent("a call that completes settles normally and disarms its deadline", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `console.log(JSON.stringify(await Promise.all([
             Bun.secrets.get({ service: "s", name: "n" }),
             Bun.secrets.get({ service: "s", name: "n", timeout: 0 }),
             Bun.secrets.get({ service: "s", name: "n", timeout: Infinity }),
             Bun.secrets.get({ service: "s", name: "n", timeout: null }),
             Bun.secrets.set({ service: "s", name: "n", value: "v", timeout: 5000 }),
             Bun.secrets.delete({ service: "s", name: "n", timeout: 5000 }),
           ])));`,
        ],
        env: stubEnv("return"),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stdout)).toEqual(["stub-value", "stub-value", "stub-value", "stub-value", null, true]);
      expect(stderr).toContain("[stub] lookup mode=return cancellable=yes");
      expect(exitCode).toBe(0);
    });

    test.concurrent("worker.terminate() cancels a call parked on the keyring", async () => {
      // The parent waits for the stub to report the call in flight, then tells
      // the child (over stdin) to terminate the worker. The worker's teardown
      // waits for the pool job, so "terminated" proves the cancel reached libsecret.
      using dir = tempDir("bun-secrets-worker", {
        "main.ts": `
          ${watchdog}
          const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
          for await (const line of console) {
            if (line === "go") break;
          }
          await worker.terminate();
          console.log("terminated");
        `,
        "worker.ts": `
          Bun.secrets.get({ service: "s", name: "n", timeout: 0 }).then(
            () => postMessage("settled"),
            () => postMessage("settled"),
          );
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.ts"],
        cwd: String(dir),
        env: stubEnv("hang"),
        stdin: "pipe",
        stderr: "pipe",
      });

      let stderr = "";
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      while (!stderr.includes("[stub] lookup mode=hang cancellable=yes")) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
      }
      expect(stderr).toContain("[stub] lookup mode=hang cancellable=yes");
      proc.stdin.write("go\n");
      await proc.stdin.end();

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
      }
      expect(stdout).toBe("terminated\n");
      expect(stderr).toContain("[stub] cancelled");
      expect(exitCode).toBe(0);
    });
  },
);
