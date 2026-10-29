// Temporary measurement, removed before this change is ready. Windows only.
// Runs one operation and prints what it added to this process: threads, commit charge, reserved address space.
// Usage: bun libuv-threadpool-stack-measure-fixture.ts <operation> <directory with data.txt and module.mjs>
import { dlopen } from "bun:ffi";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";

const { symbols: kernel32 } = dlopen("kernel32.dll", {
  CreateToolhelp32Snapshot: { args: ["u32", "u32"], returns: "u64" },
  Thread32First: { args: ["u64", "ptr"], returns: "i32" },
  Thread32Next: { args: ["u64", "ptr"], returns: "i32" },
  CloseHandle: { args: ["u64"], returns: "i32" },
  GlobalMemoryStatusEx: { args: ["ptr"], returns: "i32" },
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

const [, , name, dir] = process.argv;
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

const pending = operation();
const atReturn = added();
await pending;
const atEnd = added();
const { commitLimit, availCommit, totalPhys, availPhys } = memoryStatus();
console.log(JSON.stringify({ name, atReturn, atEnd, commitLimit, availCommit, totalPhys, availPhys }));
