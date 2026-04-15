import { CString, dlopen, FFIType, ptr, read as ffiRead } from "bun:ffi";
import { jscDescribe } from "bun:jsc";
import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { isLinux } from "../../../harness";

const libPath = join(__dirname, "libaddr32.so");

beforeAll(async () => {
  const compiler = Bun.spawn(["cc", "-shared", "-o", "libaddr32.so", "addr32.c"], {
    cwd: __dirname,
  });
  await compiler.exited;
  expect(compiler.exitCode).toBe(0);
});

// Only runs on Linux because that is where we can most reliably allocate a 32-bit pointer.
test.skipIf(!isLinux)("can use addresses encoded as int32s", async () => {
  const { symbols } = dlopen(libPath, { addr32: { args: [], returns: FFIType.pointer } });
  const addr = symbols.addr32()!;
  expect(addr).toBeGreaterThan(0);
  expect(addr).toBeLessThan(2 ** 31);
  const addrIntEncoded = addr | 0;
  expect(jscDescribe(addrIntEncoded)).toContain("Int32");
  // @ts-expect-error
  expect(new CString(addrIntEncoded).toString()).toBe("hello world");
});

// Regression test for https://github.com/oven-sh/bun/issues/29346
//
// When a handle returned via an out-parameter lands in the first 2 GiB of
// address space, `ffiRead.ptr(...)` boxes it through `JSValue.jsNumber(u64)`
// which picks an Int32 encoding. On Linux x64 the pre-fix `JSVALUE_TO_PTR`
// took the double path for every non-null non-typed-array JSValue, which
// sign-extended the Int32 into `0xFFFFFFFFxxxxxxxx` and segfaulted the
// callee. The fix (#25045) added an explicit `JSVALUE_IS_INT32` branch; this
// test exercises exactly the pattern described in the bug report (open →
// read handle → pass back as `ptr` arg).
test.skipIf(!isLinux)("issue #29346: JS number argument marshals correctly as a `ptr`", () => {
  const { symbols } = dlopen(libPath, {
    addr32_out: { args: [FFIType.ptr], returns: FFIType.i32 },
    addr32_read: { args: [FFIType.ptr], returns: FFIType.u32 },
  });

  const outBuf = new Uint8Array(8);
  expect(symbols.addr32_out(ptr(outBuf))).toBe(0);

  const handle = ffiRead.ptr(ptr(outBuf), 0);
  expect(handle).toBeGreaterThan(0);
  expect(handle).toBeLessThan(2 ** 31);
  // Confirm we're actually exercising the Int32 marshaling path — if the
  // handle ever got boxed as a double the test would pass on broken builds.
  expect(jscDescribe(handle)).toContain("Int32");

  // Pre-fix this segfaulted at 0xFFFFFFFFFFFFFFFF. Post-fix the pointer
  // round-trips and the callee reads back the magic word we wrote.
  expect(symbols.addr32_read(handle)).toBe(0xdeadbeef);
});
