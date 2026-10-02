import { CString, dlopen, FFIType } from "bun:ffi";
import { jscDescribe } from "bun:jsc";
import { expect, test } from "bun:test";
import { compileFixture, isLinux } from "harness";
import { join } from "node:path";

// Only runs on Linux because that is where we can most reliably allocate a 32-bit pointer.
test.skipIf(!isLinux)("can use addresses encoded as int32s", () => {
  const { symbols } = dlopen(compileFixture(join(import.meta.dir, "addr32.c")), {
    addr32: { args: [], returns: FFIType.pointer },
  });
  const addr = symbols.addr32()!;
  expect(addr).toBeGreaterThan(0);
  expect(addr).toBeLessThan(2 ** 31);
  const addrIntEncoded = addr | 0;
  expect(jscDescribe(addrIntEncoded)).toContain("Int32");
  // @ts-expect-error
  expect(new CString(addrIntEncoded).toString()).toBe("hello world");
});
