import { dlopen, FFIType, JSCallback, type Pointer, ptr, read } from "bun:ffi";
const library = dlopen(process.platform === "win32" ? "ucrtbase.dll" : process.platform === "darwin" ? "libSystem.B.dylib" : process.platform === "android" ? "libc.so" : "libc.so.6", {
  qsort: { args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.function], returns: FFIType.void },
});
const numbers = new Int32Array([5, 3, 9, 1]);
const compare = new JSCallback((a: Pointer, b: Pointer) => read.i32(a, 0) - read.i32(b, 0), { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 });
library.symbols.qsort(ptr(numbers), numbers.length, 4, compare.ptr!);
console.log(numbers.join());
compare.close();
