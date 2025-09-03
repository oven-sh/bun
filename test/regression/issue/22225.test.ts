import { FFIType, cc } from "bun:ffi";
import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { endianness } from "os";

test("FFI ArrayBuffer should work as pointer without segfault (issue #22225)", async () => {
  const LE = endianness() === "LE";

  // Create temp directory with test C code
  const dir = tempDirWithFiles("test-ffi-arraybuffer", {
    "test.c": `
      #include <stdint.h>
      uint32_t get(uint32_t* value) {
          return *value;
      }
    `,
  });

  // Compile C code and get FFI function
  const {
    symbols: { get },
  } = cc({
    source: `${dir}/test.c`,
    symbols: {
      get: {
        args: [FFIType.ptr],
        returns: FFIType.u32,
      },
    },
  });

  // Create test buffers
  const buff = new ArrayBuffer(4);
  const tarr = new Uint32Array(buff);
  const view = new DataView(buff);

  // Set test value
  view.setUint32(0, 420, LE);

  // Test that all three work correctly
  expect(get(view)).toBe(420);
  expect(get(tarr)).toBe(420);
  expect(get(buff)).toBe(420); // This should not segfault anymore
});
