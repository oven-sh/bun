import { cc } from "bun:ffi";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { isASAN, isWindows, tempDirWithFiles } from "harness";

// TinyCC's setjmp/longjmp error handling conflicts with ASan.
// TinyCC can't find system headers on Windows CI.
describe.skipIf(isASAN || isWindows)("FFI small buffer externalization", () => {
  const source = /* c */ `
    // Writes known data into a buffer within bounds.
    void fill_buffer(unsigned char* buffer, int size) {
      for (int i = 0; i < size; i++) buffer[i] = 0x42;
    }

    // Reads a single byte from the buffer at offset.
    unsigned char read_byte(unsigned char* buffer, int offset) {
      return buffer[offset];
    }

    // Writes a byte at a specific offset.
    void write_byte(unsigned char* buffer, int offset, unsigned char value) {
      buffer[offset] = value;
    }
  `;

  let dir: string;
  let lib: ReturnType<typeof cc>;

  beforeAll(() => {
    dir = tempDirWithFiles("ffi-gc-test", {
      "test.c": source,
    });

    lib = cc({
      source: `${dir}/test.c`,
      symbols: {
        fill_buffer: {
          args: ["pointer", "int"],
          returns: "void",
        },
        read_byte: {
          args: ["pointer", "int"],
          returns: "u8",
        },
        write_byte: {
          args: ["pointer", "int", "u8"],
          returns: "void",
        },
      },
    });
  });

  afterAll(() => {
    lib?.close();
  });

  it("small buffer data is correctly accessible via FFI after externalization", () => {
    const { read_byte, write_byte } = lib.symbols;

    // Small buffer that would use FastTypedArray (inline GC storage) without
    // externalization. Our fix externalizes it before passing to FFI.
    const buf = Buffer.alloc(16);
    buf[0] = 0xab;
    buf[15] = 0xcd;

    expect(read_byte(buf, 0)).toBe(0xab);
    expect(read_byte(buf, 15)).toBe(0xcd);

    // Write via FFI and verify from JS
    write_byte(buf, 5, 0xef);
    expect(buf[5]).toBe(0xef);
  });

  it("many small buffer FFI calls do not corrupt GC heap", () => {
    const { fill_buffer } = lib.symbols;

    // Run many iterations with small buffers to trigger GC and verify no
    // heap corruption. The original issue (#23446) caused a segfault in
    // JSC's GC after ~2550 iterations due to inline buffer overflow
    // corrupting GC metadata.
    for (let i = 0; i < 5000; i++) {
      const buf = Buffer.alloc(64);
      fill_buffer(buf, 64);

      // Verify data integrity
      expect(buf[0]).toBe(0x42);
      expect(buf[63]).toBe(0x42);

      // Create additional allocations to stress the GC
      void Buffer.from(`iteration-${i}\0`, "utf-8");

      if (i % 1000 === 0) {
        Bun.gc(true);
      }
    }
  });

  it("buffer data survives GC after externalization", () => {
    const { read_byte } = lib.symbols;

    const buf = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      buf[i] = i;
    }

    // Read via FFI to trigger externalization
    expect(read_byte(buf, 0)).toBe(0);
    expect(read_byte(buf, 31)).toBe(31);

    // Force GC
    Bun.gc(true);

    // Verify data is still intact after GC
    for (let i = 0; i < 32; i++) {
      expect(buf[i]).toBe(i);
    }

    // Verify FFI can still read correctly
    expect(read_byte(buf, 16)).toBe(16);
  });
});
