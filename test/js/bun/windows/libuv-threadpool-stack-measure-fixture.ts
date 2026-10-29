// Temporary measurement, removed before this change is ready. Windows only.
// Runs one operation and prints what it added to this process: threads, commit charge, reserved address space.
// Usage: bun libuv-threadpool-stack-measure-fixture.ts <operation> <directory with data.txt and module.mjs>
import { CFunction, dlopen } from "bun:ffi";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";

const { symbols: kernel32 } = dlopen("kernel32.dll", {
  CreateToolhelp32Snapshot: { args: ["u32", "u32"], returns: "u64" },
  Thread32First: { args: ["u64", "ptr"], returns: "i32" },
  Thread32Next: { args: ["u64", "ptr"], returns: "i32" },
  CloseHandle: { args: ["u64"], returns: "i32" },
  GlobalMemoryStatusEx: { args: ["ptr"], returns: "i32" },
  GetModuleHandleA: { args: ["ptr"], returns: "ptr" },
  GetProcAddress: { args: ["ptr", "ptr"], returns: "ptr" },
  GetCurrentProcess: { args: [], returns: "u64" },
  K32GetProcessMemoryInfo: { args: ["u64", "ptr", "u32"], returns: "i32" },
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

function memoryStatus() {
  // MEMORYSTATUSEX: dwLength, dwMemoryLoad, then ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile,
  // ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual.
  const status = Buffer.alloc(64);
  status.writeUInt32LE(status.length, 0);
  if (!kernel32.GlobalMemoryStatusEx(status)) throw new Error("GlobalMemoryStatusEx failed");
  return {
    totalPhys: Number(status.readBigUInt64LE(8)),
    availPhys: Number(status.readBigUInt64LE(16)),
    // "The current committed memory limit for the system or the current process, whichever is smaller."
    commitLimit: Number(status.readBigUInt64LE(24)),
    // "The maximum amount of memory the current process can commit."
    availCommit: Number(status.readBigUInt64LE(32)),
    availVirtual: Number(status.readBigUInt64LE(48)),
  };
}

function pageFaults() {
  // PROCESS_MEMORY_COUNTERS: cb, PageFaultCount, then eight sizes.
  const counters = Buffer.alloc(72);
  if (!kernel32.K32GetProcessMemoryInfo(kernel32.GetCurrentProcess(), counters, counters.length))
    throw new Error("K32GetProcessMemoryInfo failed");
  return counters.readUInt32LE(4);
}

const [, , name, dir] = process.argv;

// "page-faults": the work path of a pool that has started. 1,000 requests to warm up, then 10,000 that are counted.
if (name === "page-faults") {
  const statfsOnce = () =>
    new Promise<void>((resolve, reject) => fs.statfs(dir, err => (err ? reject(err) : resolve())));
  for (let i = 0; i < 1000; i++) await statfsOnce();
  const faultsBefore = pageFaults();
  const commitBefore = Bun.unsafe.memoryFootprint()!;
  const startedAt = performance.now();
  for (let i = 0; i < 10000; i++) await statfsOnce();
  const ms = performance.now() - startedAt;
  console.log(
    JSON.stringify({
      name,
      faults: pageFaults() - faultsBefore,
      commit: Bun.unsafe.memoryFootprint()! - commitBefore,
      ms,
      threads: threadCount(),
    }),
  );
  process.exit(0);
}
const existing = path.join(dir, "data.txt");
const out = path.join(dir, `out-${process.pid}.txt`);

const operations: Record<string, () => PromiseLike<unknown>> = {
  "nothing": () => new Promise(resolve => setImmediate(resolve)),
  "fs.statfs-callback": () =>
    new Promise<void>((resolve, reject) => fs.statfs(dir, err => (err ? reject(err) : resolve()))),
  "fs.stat-callback": () =>
    new Promise<void>((resolve, reject) => fs.stat(existing, err => (err ? reject(err) : resolve()))),
  "fs.promises.stat": () => fs.promises.stat(existing),
  "fs.promises.readFile": () => fs.promises.readFile(existing),
  "fs.promises.writeFile": () => fs.promises.writeFile(out, "x"),
  "fs.promises.readdir": () => fs.promises.readdir(dir),
  "fs.promises.open-close": async () => {
    const handle = await fs.promises.open(existing);
    await handle.close();
  },
  "fs.createReadStream": () =>
    new Promise((resolve, reject) => fs.createReadStream(existing).on("error", reject).on("close", resolve).resume()),
  "fs.createWriteStream": () =>
    new Promise((resolve, reject) => fs.createWriteStream(out).on("error", reject).on("close", resolve).end("x")),
  "Bun.file.text": () => Bun.file(existing).text(),
  "Bun.write": () => Bun.write(out, "x"),
  "Bun.file.writer": async () => {
    const writer = Bun.file(out).writer();
    writer.write("x");
    await writer.end();
  },
  "Bun.shell-echo": () => Bun.$`echo hi`.quiet(),
  "Bun.shell-echo-redirect": () => Bun.$`echo hi > ${out}`.quiet(),
  "dns.lookup-localhost": () => dns.promises.lookup("localhost"),
  "Bun.spawn": () => Bun.spawn({ cmd: [process.execPath, "--version"], stdout: "ignore", stderr: "ignore" }).exited,
  "import-file": () => import(path.join(dir, "module.mjs")),
};

// "uv_thread_create_ex:<bytes>": what a native addon gets from the function bun.exe exports. 8 threads that sleep.
const direct = /^uv_thread_create_ex:(\d+)$/.exec(name);
const parked: Buffer[] = [];
if (direct) {
  const stackSize = Number(direct[1]);
  const sleep = kernel32.GetProcAddress(
    kernel32.GetModuleHandleA(Buffer.from("kernel32.dll\0")),
    Buffer.from("Sleep\0"),
  );
  const address = kernel32.GetProcAddress(kernel32.GetModuleHandleA(null), Buffer.from("uv_thread_create_ex\0"));
  if (!sleep || !address) throw new Error("GetProcAddress failed");
  const uv_thread_create_ex = CFunction({ ptr: address, args: ["ptr", "ptr", "ptr", "ptr"], returns: "i32" });
  // uv_thread_options_t: unsigned int flags, then size_t stack_size. UV_THREAD_HAS_STACK_SIZE is 1.
  const options = Buffer.alloc(16);
  options.writeUInt32LE(stackSize ? 1 : 0, 0);
  options.writeBigUInt64LE(BigInt(stackSize), 8);
  const INFINITE = 0xffffffff;
  operations[name] = async () => {
    for (let i = 0; i < 8; i++) {
      const tid = Buffer.alloc(8);
      parked.push(tid);
      const rc = uv_thread_create_ex(tid, options, sleep, INFINITE);
      if (rc !== 0) throw new Error(`uv_thread_create_ex returned ${rc}`);
    }
  };
}

const operation = operations[name];
if (!operation) throw new Error(`unknown operation ${name}`);

// The first calls load and compile what the later ones reuse.
threadCount();
memoryStatus();
Bun.unsafe.memoryFootprint();

const threadsBefore = threadCount();
const virtualBefore = memoryStatus().availVirtual;
// Bun.unsafe.memoryFootprint() is the process's commit charge on Windows (PrivateUsage).
const commitBefore = Bun.unsafe.memoryFootprint()!;

function added() {
  const commit = Bun.unsafe.memoryFootprint()! - commitBefore;
  const reserve = virtualBefore - memoryStatus().availVirtual;
  const threads = threadCount() - threadsBefore;
  return { threads, commit, reserve };
}

const startedAt = performance.now();
const pending = operation();
const msToReturn = performance.now() - startedAt;
const atReturn = added();
await pending;
const msToEnd = performance.now() - startedAt;
const atEnd = added();
const { commitLimit, availCommit, totalPhys, availPhys } = memoryStatus();
console.log(
  JSON.stringify({ name, atReturn, atEnd, msToReturn, msToEnd, commitLimit, availCommit, totalPhys, availPhys }),
);
// The parked threads never return.
if (direct) process.exit(0);
