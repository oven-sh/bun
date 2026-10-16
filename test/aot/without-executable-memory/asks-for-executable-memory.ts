import { dlopen, FFIType } from "bun:ffi";
const isDarwin = process.platform === "darwin";
const library = dlopen(isDarwin ? "libSystem.B.dylib" : "libc.so.6", {
  mmap: { args: [FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
});
const read = 1, write = 2, execute = 4;
const isPrivate = 2, anonymous = isDarwin ? 0x1000 : 0x20, forGeneratedCode = isDarwin ? 0x800 : 0;
const address = library.symbols.mmap(0, 1 << 14, read | write | execute, isPrivate | anonymous | forGeneratedCode, -1, 0);
console.log(BigInt(address) === -1n ? "refused" : "granted");
