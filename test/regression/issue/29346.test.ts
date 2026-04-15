import { dlopen, read as ffiRead, FFIType, ptr } from "bun:ffi";
import { jscDescribe } from "bun:jsc";
import { expect, test } from "bun:test";
import { isLinux, tempDir } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/29346
//
// When a handle returned via an out-parameter lands in the first 2 GiB of
// address space, `ffiRead.ptr(...)` boxes it through `JSValue.jsNumber(u64)`
// which picks an Int32 encoding. The pre-fix `JSVALUE_TO_PTR` in FFI.h took
// the double path for every non-null non-typed-array JSValue, which
// sign-extended the Int32 into `0xFFFFFFFFxxxxxxxx` and segfaulted the
// callee at `0xFFFFFFFFFFFFFFFF` on Linux x64. The fix (#25045) added an
// explicit `JSVALUE_IS_INT32` branch; this test exercises exactly the
// pattern described in the bug report (open → read handle via `ffiRead.ptr`
// → pass back as `ptr` arg).
//
// Linux-only because reliably allocating a pointer inside the first 2 GiB
// (so that `JSValue.jsNumber(u64)` picks the Int32 encoding) requires
// `MAP_FIXED_NOREPLACE`.
test.skipIf(!isLinux)("JS number argument marshals correctly as a `ptr`", async () => {
  using dir = tempDir("issue-29346", {
    "lib.c": `\
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

// Write a pointer into the low 2 GiB and store the magic 0xDEADBEEF at it.
int open_handle(void **out) {
  size_t pagesize = getpagesize();
  char *attempt = (char *)(1 << 20);
  void *mapping = MAP_FAILED;
  for (int i = 0; i < 400 && mapping == MAP_FAILED;
       i++, attempt += 64 * pagesize) {
    mapping = mmap((void *)attempt, pagesize, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED_NOREPLACE, -1, 0);
  }
  if (mapping == MAP_FAILED) { *out = 0; return -1; }
  *((unsigned int *)mapping) = 0xDEADBEEFu;
  *out = mapping;
  return 0;
}

// Read the u32 at \`handle\`. Returns 0xDEADBEEF when the caller passed the
// correct pointer; a corrupted handle segfaults here.
unsigned int read_handle(void *handle) {
  if (!handle) return 0;
  return *((unsigned int *)handle);
}
`,
  });

  const libPath = join(String(dir), "lib.so");
  await using compiler = Bun.spawn({
    cmd: ["cc", "-shared", "-fPIC", "-o", libPath, "lib.c"],
    cwd: String(dir),
    stderr: "pipe",
  });
  const cErr = await compiler.stderr.text();
  const cExit = await compiler.exited;
  if (cExit !== 0) expect(cErr).toBe("");
  expect(cExit).toBe(0);

  const { symbols } = dlopen(libPath, {
    open_handle: { args: [FFIType.ptr], returns: FFIType.i32 },
    read_handle: { args: [FFIType.ptr], returns: FFIType.u32 },
  });

  const outBuf = new Uint8Array(8);
  expect(symbols.open_handle(ptr(outBuf))).toBe(0);

  const handle = ffiRead.ptr(ptr(outBuf), 0);
  expect(handle).toBeGreaterThan(0);
  expect(handle).toBeLessThan(2 ** 31);
  // Confirm we're actually exercising the Int32 marshaling path — if the
  // handle ever got boxed as a double the test would silently pass even on
  // broken builds.
  expect(jscDescribe(handle)).toContain("Int32");

  // Pre-fix this segfaulted at 0xFFFFFFFFFFFFFFFF. Post-fix the pointer
  // round-trips and the callee reads back the magic word we wrote.
  expect(symbols.read_handle(handle)).toBe(0xdeadbeef);
});
