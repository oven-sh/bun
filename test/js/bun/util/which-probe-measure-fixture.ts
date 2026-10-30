// Temporary, with which-probe-measure.test.ts. The calls that the report compares, through bun:ffi. Run as a script
// it answers the same questions with descriptors free and with none left, and prints JSON.
import { dlopen, ptr, read } from "bun:ffi";
import { closeSync, openSync } from "node:fs";

export const isMacOS = process.platform === "darwin";
// The Linux column is a stand-in, to run the script where there is no Mac: O_PATH for O_EXEC, and no getattrlist.
export const O_PROBE = isMacOS ? 0x40000000 | 0x01000000 | 0x0004 | 0x20000 : 0o10000000 | 0o2000000;
const AT_FDCWD = isMacOS ? -2 : -100;
const AT_EACCESS = isMacOS ? 0x0010 : 0x200;
const ATTR_CMN_OBJTYPE = 0x00000008;
const ATTR_CMN_OWNERID = 0x00008000;
const ATTR_CMN_GRPID = 0x00010000;
const ATTR_CMN_ACCESSMASK = 0x00020000;
const ATTR_CMN_USERACCESS = 0x00200000;
const VREG = 1;
const F_OK = 0;
const X_OK = 1;

export type Answer = { ok: boolean; errno: number; detail?: string };
export const yn = (ok: boolean) => (ok ? "Y" : "n");

export function setup(libc: string) {
  const loadErrors: string[] = [];
  function tryLoad(symbols: Record<string, { args: string[]; returns: string }>): any {
    try {
      return dlopen(libc, symbols as any).symbols;
    } catch (error) {
      loadErrors.push(String(error));
      return {};
    }
  }

  const lib = {
    ...dlopen(libc, {
      open: { args: ["ptr", "i32"], returns: "i32" },
      close: { args: ["i32"], returns: "i32" },
      access: { args: ["ptr", "i32"], returns: "i32" },
      faccessat: { args: ["i32", "ptr", "i32", "i32"], returns: "i32" },
      getpid: { args: [], returns: "i32" },
      [isMacOS ? "__error" : "__errno_location"]: { args: [], returns: "ptr" },
    } as any).symbols,
    ...(isMacOS ? tryLoad({ getattrlist: { args: ["ptr", "ptr", "ptr", "usize", "u32"], returns: "i32" } }) : {}),
    ...(isMacOS ? tryLoad({ proc_pid_rusage: { args: ["i32", "i32", "ptr"], returns: "i32" } }) : {}),
    ...(isMacOS ? tryLoad({ task_self_trap: { args: [], returns: "u32" } }) : {}),
    ...(isMacOS ? tryLoad({ task_info: { args: ["u32", "i32", "ptr", "ptr"], returns: "i32" } }) : {}),
  } as any;
  // The 64-bit-inode layout: `stat` on arm64, `stat$INODE64` on x64.
  const statName = isMacOS && process.arch === "x64" ? "stat$INODE64" : "stat";
  const stat = tryLoad({ [statName]: { args: ["ptr", "ptr"], returns: "i32" } })[statName] as
    ((path: number, out: number) => number) | undefined;
  const errnoLocation = lib.__error ?? lib.__errno_location;
  const errno = () => read.i32(errnoLocation(), 0);

  // Each view is made over its own ArrayBuffer before `ptr` reads its address: the first `.buffer` of a small typed
  // array moves its bytes.
  const attrRequest = (attributes: number) => {
    const request = new Uint8Array(new ArrayBuffer(24));
    const view = new DataView(request.buffer);
    view.setUint16(0, 5, true); // ATTR_BIT_MAP_COUNT
    view.setUint32(4, attributes, true);
    return { request, address: ptr(request) };
  };
  const typeAndAccess = attrRequest(ATTR_CMN_OBJTYPE | ATTR_CMN_USERACCESS);
  const typeOnly = attrRequest(ATTR_CMN_OBJTYPE);
  const typeModeOwner = attrRequest(ATTR_CMN_OBJTYPE | ATTR_CMN_OWNERID | ATTR_CMN_GRPID | ATTR_CMN_ACCESSMASK);
  const reply = new Uint32Array(new ArrayBuffer(64));
  const replyPtr = ptr(reply);
  const statBuffer = new Uint8Array(new ArrayBuffer(512));
  const statView = new DataView(statBuffer.buffer);
  const statPtr = ptr(statBuffer);

  // `ptr` gives an address and no reference, so every path stays in this list until the process ends.
  const pinned: Uint8Array[] = [];
  const cString = (path: string) => {
    const bytes = new Uint8Array(new ArrayBuffer(Buffer.byteLength(path) + 1));
    new TextEncoder().encodeInto(path, bytes);
    pinned.push(bytes);
    return ptr(bytes);
  };

  function openProbe(path: number): Answer {
    const fd = lib.open(path, O_PROBE);
    if (fd < 0) return { ok: false, errno: errno() };
    lib.close(fd);
    return { ok: true, errno: 0 };
  }

  function attrProbe(path: number): Answer {
    if (!isMacOS) return statProbe(path);
    if (!lib.getattrlist) return { ok: false, errno: -1 };
    reply.fill(0);
    const rc = lib.getattrlist(path, typeAndAccess.address, replyPtr, 12, 0);
    if (rc !== 0) return { ok: false, errno: errno() };
    const detail = `len=${reply[0]} type=${reply[1]} access=${reply[2]}`;
    return { ok: reply[1] === VREG && (reply[2] & X_OK) !== 0, errno: 0, detail };
  }

  // What the fix asks when `open` has no descriptor: a regular file, and execute permission for the effective user.
  function statProbe(path: number): Answer {
    if (!stat) return { ok: false, errno: -1 };
    statBuffer.fill(0);
    if (stat(path, statPtr) !== 0) return { ok: false, errno: errno() };
    // st_mode: offset 4 in the 64-bit-inode layout of macOS, offset 24 on Linux x64, 16 on Linux arm64.
    const mode = isMacOS ? statView.getUint16(4, true) : statView.getUint32(process.arch === "x64" ? 24 : 16, true);
    if ((mode & 0o170000) !== 0o100000) return { ok: false, errno: 0, detail: "mode=" + mode.toString(8) };
    if (lib.faccessat(AT_FDCWD, path, X_OK, AT_EACCESS) !== 0) return { ok: false, errno: errno() };
    return { ok: true, errno: 0 };
  }

  function probeAll(path: string) {
    const p = cString(path);
    return {
      open: openProbe(p),
      attr: attrProbe(p),
      stat: statProbe(p),
      which: Bun.which(path, { PATH: "" }) !== null,
    };
  }

  // One call of each way to ask, for the cost table.
  const shapes: Record<string, (path: number, text: string) => void> = {
    "Bun.which": (_, text) => {
      Bun.which(text, EMPTY_PATH);
    },
    "open+close": path => {
      const fd = lib.open(path, O_PROBE);
      if (fd >= 0) lib.close(fd);
    },
    "attr(type+access)": path => {
      if (lib.getattrlist) lib.getattrlist(path, typeAndAccess.address, replyPtr, 12, 0);
    },
    "stat+eaccess(X)": path => {
      if (stat && stat(path, statPtr) === 0) lib.faccessat(AT_FDCWD, path, X_OK, AT_EACCESS);
    },
    "stat": path => {
      if (stat) stat(path, statPtr);
    },
    "attr(type)": path => {
      if (lib.getattrlist) lib.getattrlist(path, typeOnly.address, replyPtr, 8, 0);
    },
    "attr(type+mode+owner)": path => {
      if (lib.getattrlist) lib.getattrlist(path, typeModeOwner.address, replyPtr, 20, 0);
    },
    "eaccess(F)": path => {
      lib.faccessat(AT_FDCWD, path, F_OK, AT_EACCESS);
    },
    "eaccess(X)": path => {
      lib.faccessat(AT_FDCWD, path, X_OK, AT_EACCESS);
    },
    "ffi": () => {
      lib.getpid();
    },
  };
  const EMPTY_PATH = { PATH: "" };

  // The instructions that the whole process retired, from the counter `/usr/bin/time -l` reads. A VM reports 0.
  const rusage = new BigUint64Array(new ArrayBuffer(512));
  const rusagePtr = ptr(rusage);
  function instructions() {
    if (!lib.proc_pid_rusage || lib.proc_pid_rusage(process.pid, 4, rusagePtr) !== 0) return null;
    // rusage_info_v4: ri_instructions at byte 248.
    return Number(rusage[31]);
  }

  // The BSD system calls that the whole process made: task_info(TASK_EVENTS_INFO).syscalls_unix, what `top` shows.
  const events = new Int32Array(new ArrayBuffer(32));
  const eventsPtr = ptr(events);
  const count = new Uint32Array(new ArrayBuffer(4));
  const countPtr = ptr(count);
  const task = lib.task_self_trap ? lib.task_self_trap() : 0;
  function syscalls() {
    if (!lib.task_info || !task) return null;
    count[0] = 8;
    if (lib.task_info(task, 2, eventsPtr, countPtr) !== 0) return null;
    return events[6];
  }

  function measure(fn: (path: number, text: string) => void, path: number, text: string, calls: number) {
    const syscallsBefore = syscalls();
    const before = instructions();
    const start = Bun.nanoseconds();
    for (let i = 0; i < calls; i++) fn(path, text);
    const ns = (Bun.nanoseconds() - start) / calls;
    const after = instructions();
    const syscallsAfter = syscalls();
    return {
      ns,
      instructions: before !== null && after !== null ? (after - before) / calls : null,
      syscalls: syscallsBefore !== null && syscallsAfter !== null ? (syscallsAfter - syscallsBefore) / calls : null,
    };
  }

  return { loadErrors, cString, probeAll, shapes, measure, syscalls };
}

if (import.meta.main) {
  const { probeAll, syscalls } = setup(process.env.LIBC!);
  const fixtures: string[] = JSON.parse(process.env.FIXTURES!);
  const base = process.env.BASE!;
  const walkPath = process.env.WALK_PATH!;
  const calls = 1000;

  const answers = () =>
    Object.fromEntries(
      fixtures.map(name => {
        const all = probeAll(name === "" ? "" : base + "/" + name);
        return [name || '""', yn(all.open.ok) + yn(all.stat.ok) + yn(all.which)];
      }),
    );
  // `Bun.which` of a name: the PATH has twelve directories, and the command is in the tenth.
  const walk = (PATH: string) => {
    const before = syscalls();
    let found = 0;
    for (let i = 0; i < calls; i++) if (Bun.which("tool", { PATH }) !== null) found++;
    const after = syscalls();
    return { found, syscallsPerCall: before !== null && after !== null ? (after - before) / calls : null };
  };
  const state = () => ({ answers: answers(), walk: walk(walkPath), emptyPathWalk: walk("") });

  state();
  const free = state();
  const held: number[] = [];
  try {
    for (;;) held.push(openSync("/dev/null", "r"));
  } catch {}
  const atLimit = state();
  for (const fd of held) closeSync(fd);
  console.log(JSON.stringify({ held: held.length, calls, free, atLimit }));
}
