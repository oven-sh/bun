// TEMPORARY: measurements for the Windows stack commit change, taken on the Windows test machines. Not tests.
// The two stack-commit-measure-*.test.ts files fail on purpose so that the numbers reach the build's failure
// report. All three files are removed before the PR is ready.
//
// "4k" is the bun.exe under test. "2m" is a copy of it whose SizeOfStackCommit (8 bytes of the PE header) is set
// back to 0x200000: the same code, linked the way main links it.

import { bunEnv, bunExe, preadExact } from "harness";
import { closeSync, copyFileSync, openSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

function peOptionalHeaderOffset(fd: number): number {
  const dos = preadExact(fd, 0, 64);
  if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not PE (no MZ)");
  const peOff = dos.readUInt32LE(60);
  if (preadExact(fd, peOff, 4).readUInt32LE(0) !== 0x00004550) throw new Error("not PE");
  if (preadExact(fd, peOff + 24, 2).readUInt16LE(0) !== 0x20b) throw new Error("not PE32+");
  return peOff + 24;
}

export function peStackSizes(path: string): { reserve: number; commit: number } {
  const fd = openSync(path, "r");
  try {
    const optional = preadExact(fd, peOptionalHeaderOffset(fd), 96);
    return { reserve: Number(optional.readBigUInt64LE(72)), commit: Number(optional.readBigUInt64LE(80)) };
  } finally {
    closeSync(fd);
  }
}

export function setStackCommit(path: string, commit: number): void {
  const fd = openSync(path, "r+");
  try {
    const field = Buffer.alloc(8);
    field.writeBigUInt64LE(BigInt(commit));
    writeSync(fd, field, 0, 8, peOptionalHeaderOffset(fd) + 80);
  } finally {
    closeSync(fd);
  }
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
export const round = (x: number, digits = 2) => Number(x.toFixed(digits));

// Both CreateThread forms, 32 threads each, parked in Sleep: commit charge per thread start.
export const commitPerThreadScript = `
  const { dlopen } = require("bun:ffi");
  const { symbols: kernel32 } = dlopen("kernel32.dll", {
    GetModuleHandleA: { args: ["ptr"], returns: "ptr" },
    GetProcAddress: { args: ["ptr", "ptr"], returns: "ptr" },
    CreateThread: { args: ["ptr", "u64", "ptr", "ptr", "u32", "ptr"], returns: "u64" },
  });
  const Sleep = kernel32.GetProcAddress(kernel32.GetModuleHandleA(Buffer.from("kernel32.dll\\0")), Buffer.from("Sleep\\0"));
  const threads = 32;
  function commitPerThread(stackSize, flags) {
    const before = Bun.unsafe.memoryFootprint();
    for (let i = 0; i < threads; i++)
      if (!kernel32.CreateThread(null, stackSize, Sleep, 0xffffffff, flags, null)) throw new Error("CreateThread failed");
    return Math.round((Bun.unsafe.memoryFootprint() - before) / threads);
  }
  console.log(JSON.stringify({ size0: commitPerThread(0, 0), reserve18M: commitPerThread(0x1200000, 0x10000) }));
  process.exit(0);
`;

// What a thread really gets for each way of asking: its reserve and its initial commit, read from the TEB of a
// thread created suspended (StackBase at +8, StackLimit at +0x10, DeallocationStack at +0x1478).
export const stackGeometryScript = `
  const { dlopen, read } = require("bun:ffi");
  const { symbols: kernel32 } = dlopen("kernel32.dll", {
    GetModuleHandleA: { args: ["ptr"], returns: "ptr" },
    GetProcAddress: { args: ["ptr", "ptr"], returns: "ptr" },
    CreateThread: { args: ["ptr", "u64", "ptr", "ptr", "u32", "ptr"], returns: "u64" },
  });
  const { symbols: ntdll } = dlopen("ntdll.dll", {
    NtQueryInformationThread: { args: ["u64", "u32", "ptr", "u32", "ptr"], returns: "i32" },
  });
  const Sleep = kernel32.GetProcAddress(kernel32.GetModuleHandleA(Buffer.from("kernel32.dll\\0")), Buffer.from("Sleep\\0"));
  const CREATE_SUSPENDED = 4, RESERVATION = 0x10000;
  function geometry(size, flags) {
    try {
      const thread = kernel32.CreateThread(null, size, Sleep, 0xffffffff, flags | CREATE_SUSPENDED, null);
      if (!thread) return "CreateThread failed";
      const info = new BigUint64Array(6);
      const status = ntdll.NtQueryInformationThread(thread, 0, info, 48, null);
      if (status !== 0) return "NtQueryInformationThread " + status;
      const teb = Number(info[1]);
      const base = read.ptr(teb, 8), limit = read.ptr(teb, 0x10), deallocation = read.ptr(teb, 0x1478);
      return [(base - deallocation) / 1024, (base - limit) / 1024];
    } catch (e) {
      return String(e);
    }
  }
  console.log(JSON.stringify({
    size0: geometry(0, 0),
    reserve64K: geometry(64 * 1024, RESERVATION),
    reserve512K: geometry(512 * 1024, RESERVATION),
    reserve2M: geometry(2 * 1024 * 1024, RESERVATION),
    reserve18M: geometry(0x1200000, RESERVATION),
    commit64K: geometry(64 * 1024, 0),
  }));
  process.exit(0);
`;

// An idle server that has collected once and run hot code once, as any real one has.
export const serveScript = `
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const commit = () => Math.round(Bun.unsafe.memoryFootprint() / 1024);
  globalThis.keep = [];
  for (let i = 0; i < 200000; i++) keep.push({ i, s: "x" + i });
  Bun.gc(true);
  let sum = 0;
  for (let j = 0; j < 200; j++) for (let i = 0; i < 100000; i++) sum += keep[i].i;
  const out = { cores: navigator.hardwareConcurrency, atStartKB: commit() };
  setTimeout(() => { out.at5sKB = commit(); }, 5000);
  setTimeout(async () => {
    out.at35sKB = commit();
    await (await fetch(server.url)).text();
    out.afterFetchKB = commit();
    Bun.gc(true);
    out.afterGcKB = commit();
    console.log(JSON.stringify(out));
    process.exit(0);
  }, 35000);
`;

// The reported failure: a process that cannot commit much more than it has. A job object limits this process's
// commit to what it has now plus the headroom.
//   threads: then start 8 threads the way WTF does (size 0). How many start, and the error of the first refusal.
//   gc:      first collect once, stay idle for 25 s so that the GC helper threads exit, and only then set the
//            limit and collect again. That collection has to start the helper threads again.
export const jobLimitScript = `
  const { dlopen } = require("bun:ffi");
  const { symbols: kernel32 } = dlopen("kernel32.dll", {
    CreateJobObjectW: { args: ["ptr", "ptr"], returns: "u64" },
    SetInformationJobObject: { args: ["u64", "u32", "ptr", "u32"], returns: "i32" },
    AssignProcessToJobObject: { args: ["u64", "u64"], returns: "i32" },
    GetCurrentProcess: { args: [], returns: "u64" },
    GetCurrentProcessId: { args: [], returns: "u32" },
    GetLastError: { args: [], returns: "u32" },
    GetModuleHandleA: { args: ["ptr"], returns: "ptr" },
    GetProcAddress: { args: ["ptr", "ptr"], returns: "ptr" },
    CreateThread: { args: ["ptr", "u64", "ptr", "ptr", "u32", "ptr"], returns: "u64" },
    CreateToolhelp32Snapshot: { args: ["u32", "u32"], returns: "u64" },
    Thread32First: { args: ["u64", "ptr"], returns: "i32" },
    Thread32Next: { args: ["u64", "ptr"], returns: "i32" },
    CloseHandle: { args: ["u64"], returns: "i32" },
  });
  const Sleep = kernel32.GetProcAddress(kernel32.GetModuleHandleA(Buffer.from("kernel32.dll\\0")), Buffer.from("Sleep\\0"));
  function threadCount() {
    try {
      const pid = kernel32.GetCurrentProcessId();
      const snapshot = kernel32.CreateToolhelp32Snapshot(4 /* TH32CS_SNAPTHREAD */, 0);
      const entry = Buffer.alloc(28); // THREADENTRY32
      entry.writeUInt32LE(28, 0);
      let count = 0;
      for (let ok = kernel32.Thread32First(snapshot, entry); ok; ok = kernel32.Thread32Next(snapshot, entry))
        if (entry.readUInt32LE(12) === pid) count++;
      kernel32.CloseHandle(snapshot);
      return count;
    } catch (e) {
      return -1;
    }
  }
  function limitCommitTo(headroom) {
    const job = kernel32.CreateJobObjectW(null, null);
    const limits = Buffer.alloc(144); // JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    limits.writeUInt32LE(0x100, 16); // LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
    limits.writeBigUInt64LE(BigInt(Bun.unsafe.memoryFootprint() + headroom), 112); // ProcessMemoryLimit
    if (!kernel32.SetInformationJobObject(job, 9, limits, 144)) throw new Error("SetInformationJobObject " + kernel32.GetLastError());
    if (!kernel32.AssignProcessToJobObject(job, kernel32.GetCurrentProcess())) throw new Error("AssignProcessToJobObject " + kernel32.GetLastError());
  }
  const headroom = Number(process.argv[2]) * 1024;
  const out = {};
  if (process.argv[3] === "threads") {
    limitCommitTo(headroom);
    out.started = 0;
    for (let i = 0; i < 8; i++) {
      if (kernel32.CreateThread(null, 0, Sleep, 0xffffffff, 0, null)) out.started++;
      else { out.error = kernel32.GetLastError(); break; }
    }
    console.log(JSON.stringify(out));
    process.exit(0);
  } else {
    globalThis.keep = [];
    for (let i = 0; i < 200000; i++) keep.push({ i, s: "x" + i });
    Bun.gc(true);
    out.threadsAfterFirstGc = threadCount();
    setTimeout(() => {
      out.threadsIdle = threadCount();
      limitCommitTo(headroom);
      console.log(JSON.stringify(out));
      Bun.gc(true);
      console.log(JSON.stringify({ survived: true, threadsAfterGc: threadCount() }));
      process.exit(0);
    }, 25000);
  }
`;

// A regexp that the DFG folds on a JIT thread (constant pattern, constant subject). Its Yarr frame is 16 bytes
// per term, and Yarr moves the stack pointer by the whole frame without a probe.
export const foldedRegExpScript = (terms: number, fold: boolean) => `
  function f(s) { return /^${Buffer.alloc(terms * 2, "a?").toString()}b$/.test(${fold ? '"aaab"' : "s"}); }
  let c = 0;
  const subjects = ["aaab", "aab"];
  for (let i = 0; i < 30000; i++) c += f(subjects[i & 1]) ? 1 : 0;
  console.log("done", c);
`;

export const recursionScript = `
  let depth = 0;
  function f() { depth++; f(); }
  try { f(); } catch (e) { console.log(depth + " " + e.constructor.name); }
`;

export const workersScript = `
  const N = 16;
  let done = 0;
  for (let i = 0; i < N; i++) {
    const worker = new Worker(new URL("./worker.js", import.meta.url).href);
    worker.onmessage = () => { worker.terminate(); if (++done === N) process.exit(0); };
  }
`;

export async function runCaptured(exe: string, args: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd: [exe, ...args], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim().slice(-160), exitCode };
}

export const json = (r: { stdout: string; stderr: string; exitCode: number | null }) => {
  try {
    return JSON.parse(r.stdout);
  } catch {
    return r;
  }
};

/** The executable under test ("4k"), a copy with 2 MB in SizeOfStackCommit ("2m"), and a copy of that copy. */
export function headerPair(cwd: string) {
  const exe4k = join(cwd, "bun-4k.exe");
  const exe2m = join(cwd, "bun-2m.exe");
  const exe2mCopy = join(cwd, "bun-2m-copy.exe");
  copyFileSync(bunExe(), exe4k);
  copyFileSync(bunExe(), exe2m);
  setStackCommit(exe2m, 0x200000);
  copyFileSync(exe2m, exe2mCopy);
  const both = async <T>(run: (exe: string) => Promise<T>) => {
    const [a, b] = await Promise.all([run(exe2m), run(exe4k)]);
    return { "2m": a, "4k": b };
  };
  const header = { "4k": peStackSizes(exe4k), "2m": peStackSizes(exe2m), bytes: statSync(exe4k).size };
  return { exe4k, exe2m, exe2mCopy, both, header };
}

/** Runs one measurement and prints it at once, so that a timeout later in the file does not lose it. */
export async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  let result: unknown;
  try {
    result = await run();
  } catch (e) {
    result = { error: String(e).slice(0, 300) };
  }
  const text = JSON.stringify({ [name]: result });
  for (let i = 0; i < text.length; i += 900) console.log(`MEASURE ${process.arch} ${text.slice(i, i + 900)}`);
}
