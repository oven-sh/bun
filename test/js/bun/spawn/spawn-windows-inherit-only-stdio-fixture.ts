// Prints the path behind stdin and behind the handle value in argv[2]. "no path" means this process has no such
// handle. Spawned by spawn-windows-inherit-only-stdio.test.ts on Windows only.
import { dlopen, FFIType, ptr } from "bun:ffi";

const kernel32 = dlopen("kernel32.dll", {
  GetStdHandle: { args: [FFIType.u32], returns: FFIType.u64 },
  GetFinalPathNameByHandleW: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.u32 },
});

function pathOf(handle: bigint): string {
  const buffer = new Uint16Array(32768);
  const length = kernel32.symbols.GetFinalPathNameByHandleW(handle, ptr(buffer), buffer.length, 0);
  if (length === 0 || length > buffer.length) return "no path";
  return Buffer.from(buffer.buffer, 0, length * 2).toString("utf16le");
}

const STD_INPUT_HANDLE = -10 >>> 0;
console.log("stdin: " + pathOf(BigInt(kernel32.symbols.GetStdHandle(STD_INPUT_HANDLE))));
console.log("extra: " + pathOf(BigInt(process.argv[2])));
