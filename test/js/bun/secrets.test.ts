import { expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isLinux, isMacOS, isWindows, tempDir } from "harness";
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

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// A libsecret whose calls never return: what a locked keyring with an unlock
// prompt nobody answers, or a Secret Service that stopped replying, looks like
// to Bun. Each call reports itself on stderr first, so the test knows when the
// threads that took the calls are stuck for good.
const LIBSECRET_STUB_C = /* c */ `
#include <stddef.h>
#include <unistd.h>

static void hang(void) {
    (void)write(2, "hung\\n", 5);
    for (;;) pause();
}

int secret_password_store_sync(const void* schema, const char* collection, const char* label,
    const char* password, void* cancellable, void** error, ...) {
    hang();
    return 0;
}

char* secret_password_lookup_sync(const void* schema, void* cancellable, void** error, ...) {
    hang();
    return NULL;
}

int secret_password_clear_sync(const void* schema, void* cancellable, void** error, ...) {
    hang();
    return 0;
}

void secret_password_free(char* password) {}
`;

// SecretsLinux.cpp dlopens GLib and GObject before libsecret and dlsyms these
// from GLib. None of them runs once the lookup hangs, so the stubs do nothing.
const GLIB_STUB_C = /* c */ `
#include <stddef.h>

void g_error_free(void* error) {}
void g_free(void* mem) {}
void* g_hash_table_new(void* hash_func, void* key_equal_func) { return NULL; }
void g_hash_table_destroy(void* hash_table) {}
void* g_hash_table_lookup(void* hash_table, void* key) { return NULL; }
void g_hash_table_insert(void* hash_table, void* key, void* value) {}
void g_list_free(void* list) {}
void g_list_free_full(void* list, void (*free_func)(void*)) {}
unsigned int g_str_hash(void* v) { return 0; }
int g_str_equal(void* v1, void* v2) { return 0; }
`;

// The shared work pool is pinned to this many threads (UV_THREADPOOL_SIZE).
const WORK_POOL_THREADS = 2;

// More calls than the work pool and the secrets pool have threads between
// them, so some are queued whichever pool they run on.
const STARVATION_FIXTURE = /* js */ `
function report(result) {
  console.log(JSON.stringify(result));
  process.exit(result.starved === false ? 0 : 1);
}

for (let i = 0; i < 8; i++) {
  Bun.secrets.get({ service: "svc-" + i, name: "n" }).then(
    value => report({ unexpected: "resolved", value }),
    error => report({ unexpected: "rejected", code: error.code, message: error.message }),
  );
}

// The test closes stdin once ${WORK_POOL_THREADS} calls are inside libsecret.
// Stdin is a pipe, so the event loop reads it, not the work pool.
await Bun.stdin.stream().getReader().read();

// Bun.file().text() runs on the work pool. The stuck calls hold the event loop
// open forever, so a read that never completes is turned into a report.
const watchdog = setTimeout(() => report({ starved: true }), 10_000);
const text = await Bun.file(import.meta.path).text();
clearTimeout(watchdog);
report({ starved: false, read: text.length > 0 });
`;

async function readUntil(stream: ReadableStream<Uint8Array>, enough: (text: string) => boolean): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let text = "";
  try {
    while (!enough(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}

test.skipIf(!isLinux || !cc)("hung keyring calls do not starve the work pool", async () => {
  using dir = tempDir("secrets-hung-keyring", {
    "libsecret_stub.c": LIBSECRET_STUB_C,
    "glib_stub.c": GLIB_STUB_C,
    "fixture.js": STARVATION_FIXTURE,
  });
  const root = String(dir);
  const stubs: [source: string, soname: string][] = [
    ["libsecret_stub.c", "libsecret-1.so.0"],
    ["glib_stub.c", "libglib-2.0.so.0"],
    ["glib_stub.c", "libgobject-2.0.so.0"],
  ];
  for (const [source, soname] of stubs) {
    await using ccProc = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", join(root, soname), join(root, source)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
    if (ccExit !== 0) throw new Error(`${soname} compile failed: ${ccErr || ccOut}`);
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    cwd: root,
    env: {
      ...bunEnv,
      LD_LIBRARY_PATH: bunEnv.LD_LIBRARY_PATH ? `${root}:${bunEnv.LD_LIBRARY_PATH}` : root,
      UV_THREADPOOL_SIZE: String(WORK_POOL_THREADS),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait until one call per work pool thread is stuck inside libsecret. A
  // fixture that exits before that printed why on stdout.
  const saturated = await Promise.race([
    readUntil(proc.stderr, text => text.split("hung\n").length > WORK_POOL_THREADS).then(() => true),
    proc.exited.then(() => false),
  ]);
  if (saturated) proc.stdin.end();

  // The fixture cannot exit on its own under BUN_DESTRUCT_VM_ON_EXIT: the VM
  // teardown waits for the stuck calls. Read its verdict, then kill it.
  const verdict = await readUntil(proc.stdout, text => text.includes("\n"));
  proc.kill();
  expect(verdict.trim()).toBe(JSON.stringify({ starved: false, read: true }));
});
