import { CString, dlopen, FFIType } from "bun:ffi";
import { jscDescribe } from "bun:jsc";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { isLinux, tempDir } from "../../../harness";

// Only runs on Linux because that is where we can most reliably allocate a 32-bit pointer.
test.skipIf(!isLinux)("can use addresses encoded as int32s", async () => {
  // Build into a temp dir (auto-removed) rather than the git-tracked test dir.
  using dir = tempDir("ffi-addr32", {});
  const soPath = join(String(dir), "libaddr32.so");
  const compiler = Bun.spawn(["cc", "-shared", "-fPIC", "-o", soPath, join(__dirname, "addr32.c")], {
    cwd: String(dir),
  });
  await compiler.exited;
  expect(compiler.exitCode).toBe(0);

  const { symbols } = dlopen(soPath, { addr32: { args: [], returns: FFIType.pointer } });
  const addr = symbols.addr32()!;
  expect(addr).toBeGreaterThan(0);
  expect(addr).toBeLessThan(2 ** 31);
  const addrIntEncoded = addr | 0;
  expect(jscDescribe(addrIntEncoded)).toContain("Int32");
  // @ts-expect-error
  expect(new CString(addrIntEncoded).toString()).toBe("hello world");
});
