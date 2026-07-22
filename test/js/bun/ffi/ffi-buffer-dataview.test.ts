import { dlopen, FFIType, ptr, suffix } from "bun:ffi";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

const cc = Bun.which("clang") || Bun.which("gcc") || Bun.which("cc");

// The fix is platform-independent, but building the shared library here
// assumes a POSIX toolchain.
describe.skipIf(isWindows || !cc)("bun:ffi buffer FFIType and DataView arguments", () => {
  let libPath: string;

  beforeAll(async () => {
    const dir = tempDirWithFiles("ffi-buffer-dataview", {
      "first_byte.c": `
        unsigned char first_byte(unsigned char* p) { return p[0]; }
      `,
    });
    libPath = join(dir, `libfirst_byte.${suffix}`);

    await using proc = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", libPath, join(dir, "first_byte.c")],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    expect(exitCode).toBe(0);
  });

  // The exported enum member `FFIType.buffer` (= 20) must be accepted
  // exactly like the string `"buffer"`. Previously the numeric form was
  // rejected with a bare "invalid ABI type".
  test("FFIType.buffer is accepted as an argument type (numeric form)", () => {
    expect(FFIType.buffer).toBe(20);

    const lib = dlopen(libPath, {
      first_byte: { args: [FFIType.buffer], returns: FFIType.u8 },
    });
    const bytes = new Uint8Array([11, 22, 33]);
    expect(lib.symbols.first_byte(bytes)).toBe(11);
    lib.close();
  });

  test("FFIType.buffer as a return type gives the byteLength/byteOffset error, not 'invalid ABI type'", () => {
    expect(() =>
      dlopen(libPath, {
        first_byte: { args: ["ptr"], returns: FFIType.buffer },
      }),
    ).toThrow(/byteLength and byteOffset are unknown/);
  });

  // The docs state `buffer` arguments "must be a TypedArray or DataView";
  // DataView has the same JSArrayBufferView layout the generated stubs read.
  test("DataView is accepted for a 'buffer' argument and its byteOffset is honored", () => {
    const lib = dlopen(libPath, {
      first_byte: { args: ["buffer"], returns: "u8" },
    });
    const backing = new Uint8Array([11, 22, 33]);
    const dv = new DataView(backing.buffer, 2);
    expect(lib.symbols.first_byte(dv)).toBe(33);
    expect(lib.symbols.first_byte(new DataView(backing.buffer))).toBe(11);
    lib.close();
  });

  // `ptr` args should accept DataView the same way the standalone `ptr()`
  // helper does.
  test("DataView is accepted for a 'ptr' argument and its byteOffset is honored", () => {
    const lib = dlopen(libPath, {
      first_byte: { args: ["ptr"], returns: "u8" },
    });
    const backing = new Uint8Array([11, 22, 33]);
    const dv = new DataView(backing.buffer, 2);
    expect(lib.symbols.first_byte(dv)).toBe(33);
    expect(lib.symbols.first_byte(ptr(dv))).toBe(33);
    lib.close();
  });

  test("non-view values are still rejected for a 'buffer' argument", () => {
    const lib = dlopen(libPath, {
      first_byte: { args: ["buffer"], returns: "u8" },
    });
    expect(() => lib.symbols.first_byte({} as any)).toThrow(/TypedArray or DataView/);
    expect(() => lib.symbols.first_byte("hello" as any)).toThrow(TypeError);
    lib.close();
  });
});
