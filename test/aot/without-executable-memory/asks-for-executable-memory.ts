import { dlopen, FFIType } from "bun:ffi";
if (process.platform === "win32") {
  const kernel32 = dlopen("kernel32.dll", { VirtualAlloc: { args: [FFIType.u64, FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.u64 } });
  const commitAndReserve = 0x3000, executeReadWrite = 0x40;
  console.log(BigInt(kernel32.symbols.VirtualAlloc(0, 1 << 14, commitAndReserve, executeReadWrite)) === 0n ? "refused" : "granted");
  process.exit(0);
}
const isDarwin = process.platform === "darwin";
const libraryName = isDarwin ? "libSystem.B.dylib" : process.platform === "android" ? "libc.so" : "libc.so.6";
if (process.argv[2] === "has-it-denied-itself") {
  const getMDWE = 66;
  const bits = isDarwin ? 0 : dlopen(libraryName, { prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 } }).symbols.prctl(getMDWE, 0, 0, 0, 0);
  console.log(bits > 0 ? "yes" : "no");
  process.exit(0);
}
const library = dlopen(libraryName, {
  mmap: { args: [FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
});
const read = 1, write = 2, execute = 4;
const isPrivate = 2, anonymous = isDarwin ? 0x1000 : 0x20, forGeneratedCode = isDarwin ? 0x800 : 0;
const address = library.symbols.mmap(0, 1 << 14, read | write | execute, isPrivate | anonymous | forGeneratedCode, -1, 0);
console.log(BigInt(address) === -1n ? "refused" : "granted");
