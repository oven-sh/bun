import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";

// `LibInfo.lookup` is only compiled on macOS; on other platforms the `system`
// backend goes through libc/libuv and this error path does not exist.
test.skipIf(!isMacOS)(
  "dns.lookup releases pending_host_cache_native slot when getaddrinfo_async_start fails",
  async () => {
    // The pending cache is a 32-entry HiveArray. Before the fix, the error path
    // called `used.set(pos)` (a no-op, since the slot was already marked used by
    // `HiveArray.get`) instead of `used.unset(pos)`, and then freed the request
    // it still pointed at. After 32 failures every slot was orphaned and the next
    // lookup with a matching hash would follow `.inflight` into freed memory.
    //
    // Drive 40 distinct failures (> 32) so the slot at index 0 is reused; if the
    // slot was not released, looking up "host-0" again would match a stale entry
    // whose `lookup` pointer dangles.
    const script = /* js */ `
    const { dns } = Bun;
    const N = 40;

    const errors = [];
    for (let i = 0; i < N; i++) {
      try {
        await dns.lookup("host-" + i + ".invalid", { backend: "system" });
        console.error("lookup " + i + " unexpectedly resolved");
        process.exit(1);
      } catch (e) {
        errors.push(String(e.message ?? e));
      }
    }

    // Repeat the first hostname. With the bug, its hash matches the stale slot
    // at index 0 and append() dereferences a freed GetAddrInfoRequest (ASAN
    // heap-use-after-free).
    try {
      await dns.lookup("host-0.invalid", { backend: "system" });
      console.error("repeat lookup unexpectedly resolved");
      process.exit(1);
    } catch (e) {
      errors.push(String(e.message ?? e));
    }

    if (errors.length !== N + 1) {
      console.error("expected " + (N + 1) + " rejections, got " + errors.length);
      process.exit(1);
    }
    for (const msg of errors) {
      if (!msg.includes("getaddrinfo_async_start error")) {
        console.error("unexpected rejection: " + msg);
        process.exit(1);
      }
    }
    console.log("ok " + errors.length);
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_FEATURE_FLAG_FORCE_LIBINFO_ASYNC_START_ERROR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok 41");
    expect(exitCode).toBe(0);
  },
);
