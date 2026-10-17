import { dlopen, FFIType, ptr } from "bun:ffi";
import { readFileSync } from "node:fs";

function onLinux(): number {
  return readFileSync("/proc/self/maps", "utf8")
    .split("\n")
    .filter(line => /^\S+ ..x. \S+ 00:00 0\s*($|\[anon)/.test(line)).length;
}

function onDarwin(): number {
  const system = dlopen("libSystem.B.dylib", {
    task_self_trap: { args: [], returns: FFIType.u32 },
    mach_vm_region: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  });
  const extendedInformation = 13, tagOfGeneratedCode = 64;
  const task = system.symbols.task_self_trap();
  const address = new BigUint64Array([0n]), size = new BigUint64Array([0n]);
  const information = new Uint32Array(16), count = new Uint32Array(1), name = new Uint32Array(1);
  let found = 0;
  for (;;) {
    count[0] = information.length;
    if (system.symbols.mach_vm_region(task, ptr(address), ptr(size), extendedInformation, ptr(information), ptr(count), ptr(name))) return found;
    if (information[1] === tagOfGeneratedCode) found++;
    address[0] += size[0];
  }
}

console.log(process.platform === "darwin" ? onDarwin() : onLinux());
