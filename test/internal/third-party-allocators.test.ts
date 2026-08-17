// mimalloc only replaces malloc() globally on Linux (scripts/build/deps/
// mimalloc.ts). Everywhere else the C libraries bun links would silently keep
// allocating from the C runtime's heap (the static uCRT on Windows), so each of
// them is pointed at mimalloc individually:
//
//   BoringSSL  OPENSSL_memory_* (everything behind OPENSSL_malloc) and
//              OPENSSL_system_* (the record buffers, error queue and
//              thread-local tables upstream keeps on plain malloc) are bound at
//              link time to src/boringssl/lib.rs, see patches/boringssl/.
//   libuv      uv_replace_allocator() at the top of main (src/bun_bin/lib.rs).
//
// ASAN builds skip all of it so the sanitizer keeps seeing those allocations.
// The probe allocates through each library's own allocator and asks mimalloc
// whether it owns the block; this pins the resulting matrix per platform.
import { expect, test } from "bun:test";
import { isASAN, isWindows } from "harness";

test("BoringSSL and libuv allocate from mimalloc", () => {
  // Resolved lazily so a build without the probe fails this test instead of
  // erroring at module load.
  const { thirdPartyAllocationsUseMimalloc } =
    require("bun:internal-for-testing") as typeof import("bun:internal-for-testing");
  expect(thirdPartyAllocationsUseMimalloc).toBeFunction();

  const hooked = !isASAN;
  expect(thirdPartyAllocationsUseMimalloc()).toEqual({
    boringssl: hooked,
    boringsslErrorQueue: hooked,
    libuv: isWindows ? hooked : null,
  });
});
