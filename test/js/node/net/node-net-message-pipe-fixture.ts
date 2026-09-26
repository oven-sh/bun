// A message-type named pipe server made of blocking Win32 calls, for node-net.test.ts.
// argv: <pipe name> <"reply-after-end" | "end-first" | "end-then-close">. Prints one line per thing it sees.
import { dlopen, ptr } from "bun:ffi";

const PIPE_ACCESS_DUPLEX = 3;
const PIPE_TYPE_MESSAGE = 4;

const { CreateNamedPipeW, ConnectNamedPipe, ReadFile, WriteFile, FlushFileBuffers, CloseHandle } = dlopen(
  "kernel32.dll",
  {
    CreateNamedPipeW: { args: ["ptr", "u32", "u32", "u32", "u32", "u32", "u32", "ptr"], returns: "i64" },
    ConnectNamedPipe: { args: ["i64", "ptr"], returns: "i32" },
    ReadFile: { args: ["i64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
    WriteFile: { args: ["i64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
    FlushFileBuffers: { args: ["i64"], returns: "i32" },
    CloseHandle: { args: ["i64"], returns: "i32" },
  },
).symbols;

const [name, scenario] = process.argv.slice(2);
const handle = CreateNamedPipeW(
  ptr(Buffer.from(name + "\0", "utf16le")),
  PIPE_ACCESS_DUPLEX,
  PIPE_TYPE_MESSAGE,
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
  // Longer than the 50 ms for which a byte-type pipe is still read after end().
  Bun.sleepSync(150);
  console.log("wrote:" + write("late reply"));
} else {
  write("hello");
  // Returns once the client has read it: a zero-length message behind unread bytes is merged into them.
  FlushFileBuffers(handle);
  write("");
  if (scenario === "end-first") readUntilEndOrClose();
}
CloseHandle(handle);
