// mimalloc only replaces malloc() globally on Linux (scripts/build/deps/
// mimalloc.ts). Everywhere else the C libraries bun links would silently keep
// allocating from the C runtime's heap (the static uCRT on Windows), so each of
// them is pointed at mimalloc individually:
//
//   BoringSSL  OPENSSL_memory_* (everything behind OPENSSL_malloc) and
//              OPENSSL_system_* (the record buffers, error queue and
//              thread-local tables upstream keeps on plain malloc) are bound at
//              link time to src/boringssl/lib.rs, see patches/boringssl/.
//   ICU        u_setMemoryFunctions() at the top of main (bun_icu_malloc.cpp);
//              macOS links the system libicucore and is left alone.
//   libuv      uv_replace_allocator() next to it (src/bun_bin/lib.rs).
//
// ASAN builds skip all of it so the sanitizer keeps seeing those allocations.
// The probe allocates through each library's own allocator and asks mimalloc
// whether it owns the block; this pins the resulting matrix per platform.
import { expect, test } from "bun:test";
import { isASAN, isMacOS, isWindows, tls } from "harness";

// Resolved lazily so a build without the probes fails these tests instead of
// erroring at module load.
function internals() {
  return require("bun:internal-for-testing") as typeof import("bun:internal-for-testing");
}

test("BoringSSL, ICU and libuv allocate from mimalloc", () => {
  const { thirdPartyAllocationsUseMimalloc } = internals();
  expect(thirdPartyAllocationsUseMimalloc).toBeFunction();

  const hooked = !isASAN;
  expect(thirdPartyAllocationsUseMimalloc()).toEqual({
    boringssl: hooked,
    boringsslErrorQueue: hooked,
    icu: hooked && !isMacOS,
    libuv: isWindows ? hooked : null,
  });
});

// The record buffers are not reachable from the probe, so count the hook
// instead: the server side of a TLS exchange runs on this thread and allocates
// a buffer per record it reads or writes. Under ASAN BoringSSL is built without
// the hooks and the count stays at zero.
test.skipIf(isASAN)("TLS record buffers are allocated through the OPENSSL_system_malloc hook", async () => {
  const { boringsslSystemMallocCount } = internals();
  expect(boringsslSystemMallocCount).toBeFunction();

  await using server = Bun.serve({
    port: 0,
    tls,
    fetch: () => new Response("hello over tls"),
  });

  const before = boringsslSystemMallocCount();
  const response = await fetch(`https://localhost:${server.port}/`, { tls: { rejectUnauthorized: false } });
  expect(await response.text()).toBe("hello over tls");
  expect(boringsslSystemMallocCount()).toBeGreaterThan(before);
});
