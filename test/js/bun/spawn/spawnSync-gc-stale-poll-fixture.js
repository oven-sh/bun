// `Bun.file(2).writer()` polls a dup of stderr on the main loop. A sink that is
// collected while Bun.spawnSync() is on the stack has to take that poll off the
// main loop, not off the private loop spawnSync installs for the call. If it
// does not, the registration outlives the close of the dup (fd 2 keeps the
// same file open), and the next dup of stderr that lands on that fd number can
// no longer be polled: epoll_ctl(EPOLL_CTL_ADD) fails with EEXIST.
//
// stderr has to be a pipe or a socket; a file or /dev/null is not polled.
import { $ } from "bun";

const errors = new Set();
function makeSink() {
  try {
    return Bun.file(2).writer();
  } catch (e) {
    errors.add(`${e.code} ${e.syscall}`);
  }
}

const child = [process.execPath, "-e", "await Bun.sleep(50); console.log(Buffer.alloc(4096, 'a').toString())"];

for (let round = 0; round < 5; round++) {
  // Garbage as soon as they are made.
  for (let i = 0; i < 6; i++) makeSink();
  // Nothing collects while spawnSync waits for the child. The collection this
  // asks for ends at the first safepoint after the wait: the Buffer made for
  // the child's stdout, which is still inside spawnSync.
  Bun.gc(false);
  Bun.spawnSync({ cmd: child, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
}

// Each new sink takes the lowest free fd number, so together they land on
// every number the last round's sinks gave back.
const sinks = [];
for (let i = 0; i < 16; i++) sinks.push(makeSink());

// The shell copies the command's stderr to a dup of its own stderr, and
// reports an error from that copy as the command's exit code.
const { exitCode, stderr } = await $`${process.execPath} -e "console.error('from the child')"`.nothrow();

console.log(JSON.stringify({ errors: [...errors], exitCode, stderr: stderr.toString() }));
