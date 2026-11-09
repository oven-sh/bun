// Named pipes as other programs make them: small, of the message type, or in the mode that does not wait.
const { dlopen, ptr, read } = require("bun:ffi");
const fs = require("node:fs");

const kernel32 = dlopen("kernel32.dll", {
  CloseHandle: { args: ["u64"], returns: "i32" },
  CreateNamedPipeW: { args: ["ptr", "u32", "u32", "u32", "u32", "u32", "u32", "ptr"], returns: "u64" },
  DisconnectNamedPipe: { args: ["u64"], returns: "i32" },
  FlushFileBuffers: { args: ["u64"], returns: "i32" },
  GetNamedPipeInfo: { args: ["u64", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
  GetStartupInfoW: { args: ["ptr"], returns: "void" },
  PeekNamedPipe: { args: ["u64", "ptr", "u32", "ptr", "ptr", "ptr"], returns: "i32" },
  ReadFile: { args: ["u64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
  SetNamedPipeHandleState: { args: ["u64", "ptr", "ptr", "ptr"], returns: "i32" },
  WriteFile: { args: ["u64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
}).symbols;

const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;
const PIPE_ACCESS_INBOUND = 1;
const PIPE_ACCESS_DUPLEX = 3;
const PIPE_NOWAIT = 1;
const PIPE_READMODE_MESSAGE = 2;
const PIPE_TYPE_MESSAGE = 4;

/** The handles of this process that are ends of pipes. */
function pipeHandles() {
  const handles = [];
  for (let handle = 4; handle < 0x4000; handle += 4) {
    if (kernel32.GetNamedPipeInfo(handle, null, null, null, null)) handles.push(handle);
  }
  return handles;
}

/** The handle behind a descriptor that the parent passed, the way the C runtime is told about it. */
function inheritedHandle(fd) {
  const startupInfo = Buffer.alloc(104);
  kernel32.GetStartupInfoW(startupInfo);
  const lpReserved2 = Number(startupInfo.readBigUInt64LE(72));
  const count = read.i32(lpReserved2, 0);
  return Number(read.u64(lpReserved2, 4 + count + fd * 8));
}

/** To a read or a write that would have to wait, the end answers at once from now on. So it does for whoever shares it. */
function setNoWait(handle) {
  if (!kernel32.SetNamedPipeHandleState(handle, ptr(new Uint32Array([PIPE_NOWAIT])), null, null)) {
    throw new Error("SetNamedPipeHandleState");
  }
}

/** An end that does not wait, so nothing here holds up the event loop but `flush()`. */
function end(handle, close) {
  const chunk = Buffer.alloc(4 * 1024 * 1024);
  const length = new Uint32Array(1);
  return {
    /** How much each read returned, until there was nothing more. One read is one message. */
    read() {
      const lengths = [];
      while (kernel32.ReadFile(handle, chunk, chunk.length, length, null)) lengths.push(length[0]);
      return lengths;
    },
    /** What there is to read. */
    text() {
      let text = "";
      while (kernel32.ReadFile(handle, chunk, chunk.length, length, null)) text += chunk.latin1Slice(0, length[0]);
      return text;
    },
    /** How much there is to read. All of a write that has to wait counts from the moment it is made. */
    available() {
      if (!kernel32.PeekNamedPipe(handle, null, 0, null, length, null)) throw new Error("PeekNamedPipe");
      return length[0];
    },
    write(text) {
      const bytes = Buffer.from(text);
      if (!kernel32.WriteFile(handle, bytes.length ? bytes : null, bytes.length, length, null))
        throw new Error("WriteFile");
      if (length[0] !== bytes.length) throw new Error("the pipe is full");
    },
    /** Returns once the other end has read everything. */
    flush() {
      if (!kernel32.FlushFileBuffers(handle)) throw new Error("FlushFileBuffers");
    },
    close,
  };
}

function pipeName() {
  return String.raw`\\.\pipe\bun-test-${crypto.randomUUID()}`;
}

/**
 * The server end of a new pipe. A client can write `quota` bytes before the server reads, and the server `outQuota`.
 * `inbound`: only the client can write.
 */
function createServer({ messages = false, quota = 4096, outQuota = quota, inbound = false } = {}) {
  const name = pipeName();
  const access = inbound ? PIPE_ACCESS_INBOUND : PIPE_ACCESS_DUPLEX;
  const mode = PIPE_NOWAIT | (messages ? PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE : 0);
  const wideName = Buffer.from(name + "\0", "utf16le");
  const handle = kernel32.CreateNamedPipeW(wideName, access, mode, 1, outQuota, quota, 0, null);
  if (handle === INVALID_HANDLE_VALUE) throw new Error("CreateNamedPipeW");
  return {
    name,
    ...end(handle, () => kernel32.CloseHandle(handle)),
    /** How a server ends a connection and keeps its end for the next client. */
    disconnect() {
      if (!kernel32.DisconnectNamedPipe(handle)) throw new Error("DisconnectNamedPipe");
    },
  };
}

/** `fs.openSync()`, which makes a synchronous handle, and the handle behind the descriptor. */
function openClient(name, flags) {
  const before = pipeHandles();
  const fd = fs.openSync(name, flags);
  const [handle] = pipeHandles().filter(handle => !before.includes(handle));
  return { fd, handle };
}

/** A client end of a pipe that somebody listens on. */
function connect(name) {
  const { fd, handle } = openClient(name, "r+");
  setNoWait(handle);
  return end(handle, () => fs.closeSync(fd));
}

module.exports = { connect, createServer, inheritedHandle, openClient, pipeName, setNoWait };
