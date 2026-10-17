import { dlopen, FFIType, ptr, read } from "bun:ffi";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

export type Measurement = {
  instructions: number;
  allThreadsInstructions?: number;
  counter: "rusage" | "perf" | "ptrace" | "none";
  privateBytes: number;
  residentBytes: number;
};
export type Request = { command: string[]; env: Record<string, string | undefined>; afterMark?: boolean; forcePtrace?: boolean };

const timeoutSeconds = 120;
const canCountBySingleSteps = process.arch !== "arm64";

function spawnBlockedOnStdin({ command, env }: Request) {
  return Bun.spawn({ cmd: ["/bin/sh", "-c", 'read line; exec "$0" "$@"', ...command], cwd: dirname(command[0]), env, stdin: "pipe", stdout: "ignore", stderr: "inherit" });
}

async function waitUntilStopped(isStopped: () => boolean, child: Bun.Subprocess, command: string[]) {
  const deadline = performance.now() + timeoutSeconds * 1000;
  while (!isStopped()) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${command.join(" ")} exited before it stopped itself (exit code ${child.exitCode}, signal ${child.signalCode})`);
    if (performance.now() > deadline) throw new Error(`${command.join(" ")} did not stop itself within ${timeoutSeconds} seconds`);
    await Bun.sleep(1);
  }
}

async function measureWithRusage(request: Request): Promise<Measurement> {
  const { proc_pid_rusage, proc_pidinfo } = dlopen("libproc.dylib", {
    proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  }).symbols;
  const PROC_PIDTBSDINFO = 3,
    sizeofBsdInfo = 136,
    pbi_status = 1,
    SSTOP = 4;
  const RUSAGE_INFO_V4 = 4,
    ri_resident_size = 8,
    ri_phys_footprint = 9,
    ri_instructions = 31;
  const bsdInfo = new Uint32Array(sizeofBsdInfo / 4);
  const usage = new BigUint64Array(40);
  const child = Bun.spawn({ cmd: request.command, cwd: dirname(request.command[0]), env: request.env, stdin: "ignore", stdout: "ignore", stderr: "inherit" });
  try {
    await waitUntilStopped(() => proc_pidinfo(child.pid, PROC_PIDTBSDINFO, 0, ptr(bsdInfo), sizeofBsdInfo) === sizeofBsdInfo && bsdInfo[pbi_status] === SSTOP, child, request.command);
    if (proc_pid_rusage(child.pid, RUSAGE_INFO_V4, ptr(usage))) throw new Error("proc_pid_rusage failed");
    return { instructions: Number(usage[ri_instructions]), counter: "rusage", privateBytes: Number(usage[ri_phys_footprint]), residentBytes: Number(usage[ri_resident_size]) };
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
}

function openLibc() {
  return dlopen("libc.so.6", {
    syscall: { args: [FFIType.i64, FFIType.ptr, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.u64], returns: FFIType.i64 },
    read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
    ptrace: { args: [FFIType.i64, FFIType.i32, FFIType.u64, FFIType.u64], returns: FFIType.i64_fast },
    waitpid: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    personality: { args: [FFIType.u64], returns: FFIType.i32 },
    prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  }).symbols;
}
type Libc = ReturnType<typeof openLibc>;

function readMemory(pid: number, executable: string) {
  let privateBytes = 0,
    residentBytes = 0,
    isExecutable = false;
  for (const line of readFileSync(`/proc/${pid}/smaps`, "utf8").split("\n")) {
    const mapping = /^[0-9a-f]+-[0-9a-f]+ \S+ [0-9a-f]+ \S+ \S+\s*(.*)$/.exec(line);
    if (mapping) isExecutable = mapping[1] === executable;
    else if (line.startsWith("Anonymous:")) privateBytes += parseInt(line.slice(10)) * 1024;
    else if (isExecutable && line.startsWith("Rss:")) residentBytes += parseInt(line.slice(4)) * 1024;
  }
  return { privateBytes, residentBytes };
}

function spawnWithoutASLR({ personality }: Libc, request: Request) {
  const ADDR_NO_RANDOMIZE = 0x0040000,
    queryPersonality = 0xffffffff;
  const previous = personality(queryPersonality);
  personality(previous | ADDR_NO_RANDOMIZE);
  try {
    return spawnBlockedOnStdin(request);
  } finally {
    personality(previous);
  }
}

function openInstructionCounter({ syscall }: Libc, pid: number, allThreads: boolean) {
  const SYS_perf_event_open = process.arch === "arm64" ? 241 : 298,
    PERF_TYPE_HARDWARE = 0,
    PERF_COUNT_HW_INSTRUCTIONS = 1n,
    sizeofAttr = 128;
  const disabled = 1n << 0n,
    inherit = 1n << 1n,
    exclude_kernel = 1n << 5n,
    exclude_hv = 1n << 6n,
    enable_on_exec = 1n << 12n;
  const attr = new BigUint64Array(sizeofAttr / 8);
  new Uint32Array(attr.buffer).set([PERF_TYPE_HARDWARE, sizeofAttr]);
  attr[1] = PERF_COUNT_HW_INSTRUCTIONS;
  attr[5] = disabled | exclude_kernel | exclude_hv | enable_on_exec | (allThreads ? inherit : 0n);
  return Number(syscall(SYS_perf_event_open, ptr(attr), pid, -1, -1, 0));
}

async function measureWithPerf(libc: Libc, request: Request): Promise<Measurement | undefined> {
  const child = spawnWithoutASLR(libc, request);
  const counters = [openInstructionCounter(libc, child.pid, false), openInstructionCounter(libc, child.pid, true)];
  const readCounter = (counter: number) => {
    const value = new BigUint64Array(1);
    if (Number(libc.read(counter, ptr(value), 8)) !== 8) throw new Error("reading the instruction counter failed");
    return Number(value[0]);
  };
  const hasCounters = counters.every(counter => counter >= 0);
  try {
    if (!hasCounters && canCountBySingleSteps) return undefined;
    child.stdin.write("\n");
    child.stdin.end();
    await waitUntilStopped(
      () => {
        const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8");
        return stat[stat.lastIndexOf(")") + 2] === "T";
      },
      child,
      request.command,
    );
    const memory = readMemory(child.pid, request.command[0]);
    if (!hasCounters) return { instructions: 0, allThreadsInstructions: 0, counter: "none", ...memory };
    return { instructions: readCounter(counters[0]), allThreadsInstructions: readCounter(counters[1]), counter: "perf", ...memory };
  } finally {
    for (const counter of counters) if (counter >= 0) libc.close(counter);
    child.kill("SIGKILL");
    await child.exited;
  }
}

async function measureWithPtrace(libc: Libc, request: Request, profile?: Profile): Promise<Measurement> {
  const { ptrace, waitpid, __errno_location } = libc;
  const PTRACE_CONT = 7,
    PTRACE_SINGLESTEP = 9,
    PTRACE_GETREGS = 12,
    PTRACE_SYSCALL = 24,
    PTRACE_SEIZE = 0x4206,
    PTRACE_INTERRUPT = 0x4207;
  const PTRACE_O_TRACESYSGOOD = 1,
    PTRACE_O_TRACEEXEC = 1 << 4,
    PTRACE_O_EXITKILL = 1 << 20,
    PTRACE_EVENT_EXEC = 4,
    PTRACE_EVENT_STOP = 128;
  const __WALL = 0x40000000,
    EINTR = 4,
    SIGTRAP = 5,
    SIGSTOP = 19,
    SYS_kill = 62;
  const rsi = 13 * 2,
    orig_rax = 15 * 2,
    rip = 16 * 2,
    registerCount = 27;
  const registers = new Uint32Array(registerCount * 2);
  const registersPointer = ptr(registers);
  const status = new Int32Array(2);
  const statusPointer = ptr(status);
  const child = spawnWithoutASLR(libc, request);
  const pid = child.pid;
  const waitForStop = () => {
    while (waitpid(pid, statusPointer, __WALL) !== pid) {
      const errno = read.i32(__errno_location()!, 0);
      if (errno !== EINTR) throw new Error(`waitpid for ${request.command[0]} failed (errno ${errno})`);
    }
    if ((status[0] & 0xff) !== 0x7f) throw new Error(`${request.command.join(" ")} exited before it stopped itself (status ${status[0]})`);
    return status[0];
  };
  try {
    if (ptrace(PTRACE_SEIZE, pid, 0, PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACEEXEC | PTRACE_O_EXITKILL)) throw new Error(`ptrace is not permitted (errno ${read.i32(__errno_location()!, 0)})`);
    ptrace(PTRACE_INTERRUPT, pid, 0, 0);
    waitForStop();
    child.stdin.write("\n");
    child.stdin.end();
    for (let signal = 0; ; ) {
      ptrace(PTRACE_CONT, pid, 0, signal);
      const stopped = waitForStop();
      if (stopped >> 16 === PTRACE_EVENT_EXEC) break;
      const stopSignal = (stopped >> 8) & 0xff;
      signal = stopped >> 16 || stopSignal === SIGTRAP ? 0 : stopSignal;
    }
    for (let signal = 0, isMarked = !request.afterMark; !isMarked; ) {
      ptrace(PTRACE_SYSCALL, pid, 0, signal);
      const stopped = waitForStop();
      const stopSignal = (stopped >> 8) & 0xff;
      signal = 0;
      if (stopSignal === (SIGTRAP | 0x80)) {
        ptrace(PTRACE_GETREGS, pid, 0, registersPointer);
        isMarked = registers[orig_rax] === SYS_kill && !registers[orig_rax + 1] && !registers[rsi] && !registers[rsi + 1];
      } else if (!(stopped >> 16) && stopSignal !== SIGTRAP) signal = stopSignal;
    }
    let instructions = 0;
    for (let signal = 0; ; ) {
      ptrace(PTRACE_SINGLESTEP, pid, 0, signal);
      const stopped = waitForStop();
      const stopSignal = (stopped >> 8) & 0xff;
      signal = 0;
      if (stopped >> 16 === PTRACE_EVENT_STOP && stopSignal === SIGSTOP) break;
      if (stopped >> 16) continue;
      if (stopSignal === SIGTRAP) {
        instructions++;
        if (profile) {
          ptrace(PTRACE_GETREGS, pid, 0, registersPointer);
          const address = registers[rip + 1] * 0x100000000 + registers[rip];
          profile.instructions.set(address, (profile.instructions.get(address) ?? 0) + 1);
        }
      } else if (stopSignal === SIGSTOP) break;
      else signal = stopSignal;
    }
    if (profile) profile.maps = readFileSync(`/proc/${pid}/maps`, "utf8");
    return { instructions, counter: "ptrace", ...readMemory(pid, request.command[0]) };
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
}

export type Profile = { instructions: Map<number, number>; maps: string };

export async function profileStartup(request: Request): Promise<Profile> {
  const profile: Profile = { instructions: new Map(), maps: "" };
  await measureWithPtrace(openLibc(), request, profile);
  return profile;
}

export async function measureStartup(request: Request): Promise<Measurement> {
  if (process.platform === "darwin") return measureWithRusage(request);
  const libc = openLibc();
  const PR_SET_THP_DISABLE = 41;
  libc.prctl(PR_SET_THP_DISABLE, 1, 0, 0, 0);
  const measured = !request.forcePtrace && (await measureWithPerf(libc, request));
  if (!measured && !canCountBySingleSteps) throw new Error("single-stepping cannot count on arm64: a store-exclusive never succeeds under it");
  return measured || measureWithPtrace(libc, request);
}

if (import.meta.main) console.log(JSON.stringify(await measureStartup(await Bun.stdin.json())));
