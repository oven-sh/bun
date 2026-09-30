// A named pipe server made of blocking Win32 calls, for node-net.test.ts. Its pipe is message-type unless it is "byte".
// argv: <pipe name>
//       <"reply-after-end" | "silent-after-end" | "disconnect-after-end" | "ignore-end" | "end-first" | "end-then-close"
//        | "reply-then-close">
//       <"plain" | "reject-remote" | "byte">.
// Prints one line per thing it sees.
import { dlopen, ptr } from "bun:ffi";

const PIPE_ACCESS_DUPLEX = 3;
const PIPE_TYPE_MESSAGE = 4;
// go-winio (the Docker engine's and Podman's pipes) and mpv set it on every pipe.
const PIPE_REJECT_REMOTE_CLIENTS = 8;

const { CreateNamedPipeW, ConnectNamedPipe, DisconnectNamedPipe, ReadFile, WriteFile, FlushFileBuffers, CloseHandle } =
  dlopen("kernel32.dll", {
    CreateNamedPipeW: { args: ["ptr", "u32", "u32", "u32", "u32", "u32", "u32", "ptr"], returns: "i64" },
    ConnectNamedPipe: { args: ["i64", "ptr"], returns: "i32" },
    DisconnectNamedPipe: { args: ["i64"], returns: "i32" },
    ReadFile: { args: ["i64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
    WriteFile: { args: ["i64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
    FlushFileBuffers: { args: ["i64"], returns: "i32" },
    CloseHandle: { args: ["i64"], returns: "i32" },
  }).symbols;

const [name, scenario, flags] = process.argv.slice(2);
const handle = CreateNamedPipeW(
  ptr(Buffer.from(name + "\0", "utf16le")),
  PIPE_ACCESS_DUPLEX,
  (flags === "byte" ? 0 : PIPE_TYPE_MESSAGE) | (flags === "reject-remote" ? PIPE_REJECT_REMOTE_CLIENTS : 0),
  1,
  4096,
  4096,
  0,
  null,
);
if (handle === -1n || handle === -1) throw new Error("CreateNamedPipeW failed");
console.log("listening");
ConnectNamedPipe(handle, null);

/** A message's text ("" for a zero-length message), or null once the client has closed. */
function read(): string | null {
  const buffer = Buffer.alloc(4096);
  const count = new Uint32Array(1);
  if (!ReadFile(handle, ptr(buffer), buffer.length, ptr(count), null)) return null;
  return buffer.toString("utf8", 0, count[0]);
}

function write(text: string) {
  const bytes = Buffer.from(text);
  const count = new Uint32Array(1);
  return WriteFile(handle, bytes.length ? ptr(bytes) : null, bytes.length, ptr(count), null) !== 0;
}

function readUntilEndOrClose() {
  while (true) {
    const message = read();
    if (message === null) return console.log("closed");
    if (message === "") return console.log("end-of-write");
    console.log("data:" + message);
  }
}

if (scenario === "reply-after-end") {
  readUntilEndOrClose();
  // Longer than the 50 ms for which a pipe that is not to stay half-open is still read after end().
  Bun.sleepSync(150);
  console.log("wrote:" + write("late reply"));
} else if (scenario === "silent-after-end") {
  readUntilEndOrClose();
  // Says nothing more, and stays for as long as the client does.
  readUntilEndOrClose();
} else if (scenario === "ignore-end") {
  // What mpv's IPC server does: a read of no bytes is nothing to it, and the client closing is the end.
  while (true) {
    const message = read();
    if (message === null) break;
    if (message !== "") console.log("data:" + message);
  }
  console.log("closed");
} else if (scenario === "disconnect-after-end") {
  // What Microsoft's "Multithreaded Pipe Server" sample does when a read returns no bytes.
  readUntilEndOrClose();
  console.log("wrote:" + write("reply"));
  FlushFileBuffers(handle);
  DisconnectNamedPipe(handle);
} else if (scenario === "reply-then-close") {
  write("hello");
  // Returns once the client has taken it out of the pipe.
  FlushFileBuffers(handle);
} else {
  write("hello");
  // Returns once the client has read it: a zero-length message behind unread bytes is merged into them.
  FlushFileBuffers(handle);
  write("");
  if (scenario === "end-first") readUntilEndOrClose();
}
CloseHandle(handle);
