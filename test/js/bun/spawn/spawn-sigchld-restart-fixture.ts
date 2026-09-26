// Blocks the main thread in read(2) while a child that this thread spawned exits, then
// prints what read() returned. read() is called through bun:ffi, so nothing retries EINTR.
//
// Run it with BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: only the waiter thread can reap the
// child while the main thread is blocked.
import { dlopen, FFIType, ptr } from "bun:ffi";

const libc = dlopen(process.argv[2], {
  pipe: { args: [FFIType.ptr], returns: FFIType.i32 },
  read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
  write: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
}).symbols;

function pipe() {
  const fds = new Int32Array(2);
  if (libc.pipe(ptr(fds)) !== 0) throw new Error("pipe() failed");
  return fds;
}

// The waiter thread installs its SIGCHLD handler before it reaps its first child.
await Bun.spawn({ cmd: ["true"], stdio: ["ignore", "ignore", "ignore"] }).exited;

const [goRead, goWrite] = pipe();
const [doneRead, doneWrite] = pipe();

// The shell waits for "go", then for this thread to sleep (in the read() below), then it
// exits. The kernel offers a child's SIGCHLD first to the thread that spawned the child
// (complete_signal() in kernel/signal.c), which is this one.
// The background subshell keeps the write end of the "done" pipe. It writes one byte when
// the shell is gone, that is, after the SIGCHLD handler woke the waiter thread to reap it.
const script = [
  "read go",
  // The thread state is the field after the last ')' of /proc/<pid>/task/<tid>/stat.
  "while read -r stat < /proc/$PPID/task/$PPID/stat; do",
  "  state=${stat##*) }",
  '  [ "${state%% *}" = S ] && break',
  "done",
  "( while kill -0 $$ 2>/dev/null; do :; done; printf x ) &",
  "exit 0",
].join("\n");
Bun.spawn({ cmd: ["sh", "-c", script], stdio: [goRead, doneWrite, "inherit"] });
libc.close(goRead);
libc.close(doneWrite);

const go = Buffer.from("go\n");
const byte = new Uint8Array(1);
libc.write(goWrite, ptr(go), go.length);
const n = libc.read(doneRead, ptr(byte), 1);

console.log(JSON.stringify({ read: Number(n), byte: String.fromCharCode(byte[0]) }));
