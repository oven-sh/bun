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

function onWindows(): number {
  const kernel32 = dlopen("kernel32.dll", { VirtualQuery: { args: [FFIType.u64, FFIType.ptr, FFIType.u64], returns: FFIType.u64 } });
  const information = new BigUint64Array(6);
  const words = new Uint32Array(information.buffer);
  const isPrivate = 0x20000, anyExecute = 0xf0;
  let found = 0;
  for (let address = 0n; kernel32.symbols.VirtualQuery(address, ptr(information), information.byteLength); address = information[0] + information[3]) {
    const [allocationProtection, type] = [words[4], words[10]];
    if (type === isPrivate && allocationProtection & anyExecute && information[0] === information[1]) found++;
  }
  return found;
}

console.log(process.platform === "darwin" ? onDarwin() : process.platform === "win32" ? onWindows() : onLinux());
