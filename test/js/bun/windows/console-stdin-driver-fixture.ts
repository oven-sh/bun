// Runs a command on a real (headless) Windows console and types into it.
//
// Usage: bun console-stdin-driver-fixture.ts <spec.json>
//   spec: { cmd: string, cwd: string, keys: string[] }
// Prints { exit, timedOut } for the command as JSON on stdout.
//
// This is a separate process because a process has at most one console and
// swapping it (FreeConsole + AllocConsole) would take the test runner off its
// own. keys[0] is queued with WriteConsoleInputW before the command starts:
// conhost interprets queued input with whatever mode is in effect when the
// program reads (cooked line input for prompt(), raw for the REPL), so no
// synchronization with the child is needed for it. Every further entry is typed
// once the child has drained the input queue, so the child gets it in a
// separate read from everything before it. The child is put in a job object
// that kills it when this process goes away, so a hung child cannot outlive
// the test.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { readFileSync } from "node:fs";

const spec: { cmd: string; cwd: string; keys: string[] } = JSON.parse(readFileSync(process.argv[2], "utf8"));

const kernel32 = dlopen("kernel32.dll", {
  FreeConsole: { args: [], returns: FFIType.i32 },
  AllocConsole: { args: [], returns: FFIType.i32 },
  GetLastError: { args: [], returns: FFIType.u32 },
  CreateFileW: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
    returns: FFIType.u64,
  },
  WriteConsoleInputW: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  GetNumberOfConsoleInputEvents: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
  SetInformationJobObject: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  AssignProcessToJobObject: { args: [FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  CreateProcessW: {
    args: [
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.i32,
      FFIType.u32,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
  ResumeThread: { args: [FFIType.u64], returns: FFIType.u32 },
  WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
  GetExitCodeProcess: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  TerminateProcess: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
  CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
}).symbols;

const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;
const WAIT_OBJECT_0 = 0;
const wstr = (s: string) => Buffer.from(s + "\0", "utf16le");
const fail = (what: string): never => {
  throw new Error(`${what} failed, GetLastError=${kernel32.GetLastError()}`);
};

kernel32.FreeConsole();
if (kernel32.AllocConsole() === 0) fail("AllocConsole");

// SECURITY_ATTRIBUTES { DWORD nLength; LPVOID lpSecurityDescriptor; BOOL bInheritHandle }
const inheritable = Buffer.alloc(24);
inheritable.writeUInt32LE(24, 0);
inheritable.writeInt32LE(1, 16);
function openConsoleDevice(name: string): bigint {
  const GENERIC_READ_WRITE = 0xc0000000;
  const FILE_SHARE_READ_WRITE = 3;
  const OPEN_EXISTING = 3;
  const path = wstr(name);
  const handle = kernel32.CreateFileW(
    ptr(path),
    GENERIC_READ_WRITE,
    FILE_SHARE_READ_WRITE,
    ptr(inheritable),
    OPEN_EXISTING,
    0,
    null,
  ) as bigint;
  if (handle === INVALID_HANDLE_VALUE) fail(`CreateFileW(${name})`);
  return handle;
}
const conin = openConsoleDevice("CONIN$");
const conout = openConsoleDevice("CONOUT$");

// One KEY_EVENT INPUT_RECORD (20 bytes) per UTF-16 code unit, key down then
// key up, exactly as conhost would queue them for typing. "\r" is Enter and
// "\x1a" is Ctrl+Z; everything else is delivered purely through UnicodeChar.
function keyEvents(text: string): Buffer {
  const KEY_EVENT = 0x0001;
  const VK_RETURN = 0x0d;
  const LEFT_CTRL_PRESSED = 0x0008;
  const records = Buffer.alloc(text.length * 2 * 20);
  let offset = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const [virtualKey, controlKeyState] =
      unit === 0x0d ? [VK_RETURN, 0] : unit === 0x1a ? ["Z".charCodeAt(0), LEFT_CTRL_PRESSED] : [0, 0];
    for (const keyDown of [1, 0]) {
      records.writeUInt16LE(KEY_EVENT, offset);
      records.writeInt32LE(keyDown, offset + 4);
      records.writeUInt16LE(1, offset + 8); // wRepeatCount
      records.writeUInt16LE(virtualKey, offset + 10);
      records.writeUInt16LE(unit, offset + 14); // uChar.UnicodeChar
      records.writeUInt32LE(controlKeyState, offset + 16);
      offset += 20;
    }
  }
  return records;
}

const dword = Buffer.alloc(4);
function type(text: string) {
  const records = keyEvents(text);
  const count = records.length / 20;
  if (kernel32.WriteConsoleInputW(conin, ptr(records), count, ptr(dword)) === 0) fail("WriteConsoleInputW");
  if (dword.readUInt32LE(0) !== count)
    throw new Error(`WriteConsoleInputW queued ${dword.readUInt32LE(0)} of ${count}`);
}
function queuedInputEvents(): number {
  if (kernel32.GetNumberOfConsoleInputEvents(conin, ptr(dword)) === 0) fail("GetNumberOfConsoleInputEvents");
  return dword.readUInt32LE(0);
}

type(spec.keys[0]);

const job = kernel32.CreateJobObjectW(null, null) as bigint;
if (job === 0n) fail("CreateJobObjectW");
// JOBOBJECT_EXTENDED_LIMIT_INFORMATION with BasicLimitInformation.LimitFlags =
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
const JobObjectExtendedLimitInformation = 9;
const limits = Buffer.alloc(144);
limits.writeUInt32LE(0x2000, 16);
if (kernel32.SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr(limits), limits.length) === 0) {
  fail("SetInformationJobObject");
}

// STARTUPINFOW: cb @0, dwFlags @60, hStdInput @80, hStdOutput @88, hStdError @96.
// Without STARTF_USESTDHANDLES the child would get copies of this process's
// pipes as stdio rather than the console.
const STARTF_USESTDHANDLES = 0x100;
const CREATE_SUSPENDED = 0x4;
const startupInfo = Buffer.alloc(104);
startupInfo.writeUInt32LE(startupInfo.length, 0);
startupInfo.writeUInt32LE(STARTF_USESTDHANDLES, 60);
startupInfo.writeBigUInt64LE(conin, 80);
startupInfo.writeBigUInt64LE(conout, 88);
startupInfo.writeBigUInt64LE(conout, 96);
const processInfo = Buffer.alloc(24);
const commandLine = wstr(spec.cmd);
const cwd = wstr(spec.cwd);
if (
  kernel32.CreateProcessW(
    null,
    ptr(commandLine),
    null,
    null,
    1,
    CREATE_SUSPENDED,
    null,
    ptr(cwd),
    ptr(startupInfo),
    ptr(processInfo),
  ) === 0
) {
  fail("CreateProcessW");
}
const hProcess = processInfo.readBigUInt64LE(0);
const hThread = processInfo.readBigUInt64LE(8);
if (kernel32.AssignProcessToJobObject(job, hProcess) === 0) fail("AssignProcessToJobObject");
kernel32.ResumeThread(hThread);

const deadline = Date.now() + 30_000;
const childExited = (waitMs: number) => kernel32.WaitForSingleObject(hProcess, waitMs) === WAIT_OBJECT_0;
for (const text of spec.keys.slice(1)) {
  while (queuedInputEvents() > 0 && Date.now() < deadline && !childExited(0)) {
    await Bun.sleep(1);
  }
  type(text);
}
const timedOut = !childExited(Math.max(0, deadline - Date.now()));
if (timedOut) kernel32.TerminateProcess(hProcess, 1);
kernel32.GetExitCodeProcess(hProcess, ptr(dword));
kernel32.CloseHandle(hThread);
kernel32.CloseHandle(hProcess);
console.log(JSON.stringify({ exit: dword.readUInt32LE(0), timedOut }));
