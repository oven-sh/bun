import { CString, dlopen, FFIType } from "bun:ffi";
import { describe } from "bun:jsc";
import { expect, test } from "bun:test";
import { isLinux } from "../../../harness";

// Only runs on Linux because that is where we can most reliably allocate a 32-bit pointer.
test.skipIf(!isLinux)("can use addresses encoded as int32s", async () => {
  const compiler = Bun.spawn(["cc", "-shared", "-o", "libaddr32.so", "addr32.c"], {
    cwd: __dirname,
  });
  await compiler.exited;
  expect(compiler.exitCode).toBe(0);

  const { symbols } = dlopen("./libaddr32.so", { addr32: { args: [], returns: FFIType.pointer } });
  const addr = symbols.addr32();
  expect(addr).toBeGreaterThan(0);
  expect(addr).toBeLessThan(2 ** 31);
  const addrIntEncoded = addr | 0;
  expect(describe(addrIntEncoded)).toContain("Int32");
  expect(new CString(addrIntEncoded).toString()).toBe("hello world");
});
