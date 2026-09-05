// Opens a pty the way node-pty does (master with O_NONBLOCK), wraps the master
// in tty.ReadStream and reports every stream event on stdout. The test writes
// to the slave and ends the stream with one command on stdin:
//   "destroy": the fixture calls stream.destroy()
//   "hangup":  the fixture closes its slave fd. Once the test has closed its own
//              slave, the master read fails (EIO) or ends.
import { CString, dlopen, ptr } from "bun:ffi";
import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { ReadStream } from "node:tty";

const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
const candidates = process.platform === "darwin" ? ["libSystem.B.dylib"] : ["libc.so.6", `libc.musl-${arch}.so.1`];
let libc;
let lastError;
for (const lib of candidates) {
  try {
    libc = dlopen(lib, {
      posix_openpt: { args: ["int"], returns: "int" },
      grantpt: { args: ["int"], returns: "int" },
      unlockpt: { args: ["int"], returns: "int" },
      ptsname: { args: ["int"], returns: "ptr" },
      ioctl: { args: ["int", "u64", "ptr"], returns: "int" },
    }).symbols;
    break;
  } catch (err) {
    lastError = err;
  }
}
if (!libc) throw lastError;

const master = libc.posix_openpt(constants.O_RDWR | constants.O_NOCTTY | constants.O_NONBLOCK);
if (master < 0) throw new Error("posix_openpt failed");
if (libc.grantpt(master) !== 0) throw new Error("grantpt failed");
if (libc.unlockpt(master) !== 0) throw new Error("unlockpt failed");
const slavePath = new CString(libc.ptsname(master)).toString();
// Keep the slave open on our side too, so a master read never fails before the
// test has opened the slave.
const slave = openSync(slavePath, constants.O_RDWR | constants.O_NOCTTY);

function say(line: string) {
  process.stdout.write(line + "\n");
}

function masterIsOpen() {
  try {
    fstatSync(master);
    return true;
  } catch {
    return false;
  }
}

// node-pty's pty.resize() is ioctl(master, TIOCSWINSZ, &winsize). It fails with
// EBADF once the stream has closed the master behind node-pty's back. ioctl is
// variadic, and Apple's arm64 ABI passes variadic arguments on the stack, so
// the fixed-arity FFI call is Linux only. macOS falls back to fstat.
function resize(cols: number, rows: number) {
  if (process.platform !== "linux") return masterIsOpen();
  const TIOCSWINSZ = 0x5414n;
  // struct winsize { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel; }
  const winsize = new Uint16Array([rows, cols, 0, 0]);
  return libc.ioctl(master, TIOCSWINSZ, ptr(winsize)) === 0;
}

const stream = new ReadStream(master);
stream.on("error", err => say("ERROR " + err.code));
stream.on("end", () => say("END"));
stream.on("close", () => {
  say(`CLOSE destroyed=${stream.destroyed} masterOpen=${masterIsOpen()}`);
  // Nothing else keeps the process alive once the command channel is gone.
  process.stdin.destroy();
});
stream.on("data", chunk => {
  say("DATA " + JSON.stringify(chunk.toString()));
  say("RESIZE " + (resize(120, 40) ? "ok" : "failed"));
  say("READY");
});

process.stdin.on("data", command => {
  if (String(command).includes("destroy")) {
    stream.destroy();
  } else if (String(command).includes("hangup")) {
    closeSync(slave);
  }
});

say("SLAVE " + slavePath);
say("READY");
