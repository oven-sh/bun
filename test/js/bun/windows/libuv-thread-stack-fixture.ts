// Windows only. Starts libuv threads in one of two ways and prints what that added to this process, as JSON:
// the threads, the commit charge, and the address space that is reserved.
import { CFunction, dlopen } from "bun:ffi";
import { statfs } from "node:fs";

const { symbols: kernel32 } = dlopen("kernel32.dll", {
  CreateToolhelp32Snapshot: { args: ["u32", "u32"], returns: "u64" },
  Thread32First: { args: ["u64", "ptr"], returns: "i32" },
  Thread32Next: { args: ["u64", "ptr"], returns: "i32" },
  CloseHandle: { args: ["u64"], returns: "i32" },
  GlobalMemoryStatusEx: { args: ["ptr"], returns: "i32" },
  GetModuleHandleA: { args: ["ptr"], returns: "ptr" },
  GetProcAddress: { args: ["ptr", "ptr"], returns: "ptr" },
});

function threadCount() {
  const TH32CS_SNAPTHREAD = 4;
  const snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  // THREADENTRY32: dwSize, cntUsage, th32ThreadID, th32OwnerProcessID, and 12 bytes that are not read here.
  const entry = Buffer.alloc(28);
  entry.writeUInt32LE(entry.length, 0);
  let count = 0;
  for (let more = kernel32.Thread32First(snapshot, entry); more; more = kernel32.Thread32Next(snapshot, entry))
    if (entry.readUInt32LE(12) === process.pid) count++;
  kernel32.CloseHandle(snapshot);
  return count;
}

function availableAddressSpace() {
  // MEMORYSTATUSEX: dwLength, dwMemoryLoad, then seven 64-bit counts. ullAvailVirtual is the sixth of them.
  const status = Buffer.alloc(64);
  status.writeUInt32LE(status.length, 0);
  if (!kernel32.GlobalMemoryStatusEx(status)) throw new Error("GlobalMemoryStatusEx failed");
  return Number(status.readBigUInt64LE(48));
}

function sample() {
  return {
    threads: threadCount(),
    addressSpace: availableAddressSpace(),
    // The process's commit charge on Windows (PrivateUsage).
    commit: Bun.unsafe.memoryFootprint()!,
  };
}

const how = process.argv[2];
let start: () => void;
if (how === "pool") {
  // An fs request with a callback goes to libuv's pool. The pool starts all of its threads before the call returns,
  // each with a stack size of 8 MiB.
  start = () => statfs(".", () => {});
} else {
  // What a native addon can do: call the uv_thread_create_ex that bun.exe exports, with a stack size.
  const address = kernel32.GetProcAddress(kernel32.GetModuleHandleA(null), Buffer.from("uv_thread_create_ex\0"));
  const sleep = kernel32.GetProcAddress(
    kernel32.GetModuleHandleA(Buffer.from("kernel32.dll\0")),
    Buffer.from("Sleep\0"),
  );
  if (!address || !sleep) throw new Error("GetProcAddress failed");
  const uv_thread_create_ex = CFunction({ ptr: address, args: ["ptr", "ptr", "ptr", "ptr"], returns: "i32" });
  // uv_thread_options_t: unsigned int flags, then size_t stack_size.
  const options = Buffer.alloc(16);
  const UV_THREAD_HAS_STACK_SIZE = 1;
  options.writeUInt32LE(UV_THREAD_HAS_STACK_SIZE, 0);
  options.writeBigUInt64LE(BigInt(8 * 1024 * 1024), 8);
  const INFINITE = 0xffffffff;
  start = () => {
    // The threads sleep, so that all 8 are there to count.
    for (let i = 0; i < 8; i++) {
      const rc = uv_thread_create_ex(Buffer.alloc(8), options, sleep, INFINITE);
      if (rc !== 0) throw new Error(`uv_thread_create_ex returned ${rc}`);
    }
  };
}

// The first sample loads and compiles what the next two use.
sample();
const before = sample();
start();
const after = sample();
console.log(
  JSON.stringify({
    threads: after.threads - before.threads,
    commit: after.commit - before.commit,
    reserve: before.addressSpace - after.addressSpace,
  }),
);
// The threads that sleep never return.
if (how !== "pool") process.exit(0);
