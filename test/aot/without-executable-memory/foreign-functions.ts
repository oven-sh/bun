import { dlopen, FFIType } from "bun:ffi";
const library = dlopen(process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6", { abs: { args: [FFIType.i32], returns: FFIType.i32 } });
console.log(library.symbols.abs(-5));
