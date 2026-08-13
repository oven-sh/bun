import { spawn } from "bun";
import { dlopen } from "bun:ffi";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isWindows, libcPathForDlopen, tempDir } from "harness";
import path from "path";

describe.each(["advanced", "json"])("ipc mode %s", mode => {
  it("the subprocess should be defined and the child should send", done => {
    gcTick();
    const returned_subprocess = spawn([bunExe(), path.join(__dirname, "bun-ipc-child.js")], {
      ipc: (message, subProcess) => {
        expect(subProcess).toBe(returned_subprocess);
        expect(message).toBe("hello");
        subProcess.kill();
        done();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });
  });

  it("the subprocess should receive the parent message and respond back", done => {
    gcTick();

    const parentMessage = "I am your father";
    const childProc = spawn([bunExe(), path.join(__dirname, "bun-ipc-child-respond.js")], {
      ipc: (message, subProcess) => {
        expect(message).toBe(`pong:${parentMessage}`);
        subProcess.kill();
        done();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });

    childProc.send(parentMessage);
    gcTick();
  });

  it("ipc works when preceded by a non-pipe extra stdio slot", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    await using child = spawn([bunExe(), path.join(__dirname, "bun-ipc-child.js")], {
      env: bunEnv,
      stdio: ["inherit", "inherit", "inherit", "ignore"],
      serialization: mode,
      ipc: message => resolve(message),
    });
    child.exited.then(code => reject(new Error(`exited ${code} before message`)));
    expect(await promise).toBe("hello");
  });

  it("delivers the outer message when a getter run during send enqueues more sends", async () => {
    const childSource = [
      `const fill = Buffer.alloc(8192, "x").toString();`,
      `const obj = {`,
      `  get inner() {`,
      `    for (let i = 0; i < 32; i++) process.send({ nested: i, fill });`,
      `    return "outer";`,
      `  },`,
      `};`,
      `process.send(obj);`,
      `process.on("message", () => {});`,
    ].join("\n");
    const { promise, resolve, reject } = Promise.withResolvers<any[]>();
    const messages: any[] = [];
    await using child = spawn([bunExe(), "-e", childSource], {
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization: mode,
      ipc(message) {
        messages.push(message);
        if (messages.length === 33) resolve(messages);
      },
      onExit(_subprocess, exitCode, signalCode) {
        reject(new Error(`child exited (${exitCode}, ${signalCode}) after ${messages.length} messages`));
      },
    });
    const received = await promise;
    expect(received.filter(message => "inner" in message)).toEqual([{ inner: "outer" }]);
    expect(
      received
        .filter(message => "nested" in message)
        .map(message => message.nested)
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });
});

describe("ipc mode advanced", () => {
  it("unwraps the Buffer envelope before cmd dispatch", async () => {
    // A cmd-bearing message whose payload holds a Buffer travels as the
    // [message, buffers] envelope. The receiver's cmd fast-path reads
    // message.cmd straight off the decoded value, so the envelope must be
    // restored first — otherwise the fast-get sees an array (no cmd), the
    // NODE_HANDLE interception is skipped, and user listeners receive the
    // raw envelope instead of the message.
    const childSource = [
      // A non-NODE cmd goes through the same fast-get, then to the user.
      `process.send({ cmd: "USER_CMD", payload: Buffer.from("through-dispatch") });`,
      // A NODE_HANDLE cmd (no fd attached) must be intercepted, NACKed and
      // withheld from user listeners — proving cmd was readable post-restore.
      `process.send({ cmd: "NODE_HANDLE", type: "net.Socket", msg: { buf: Buffer.from("hidden") } });`,
      `process.send({ done: true });`,
      `process.on("message", () => {});`,
    ].join("\n");
    const { promise, resolve, reject } = Promise.withResolvers<any[]>();
    const messages: any[] = [];
    await using child = spawn([bunExe(), "-e", childSource], {
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization: "advanced",
      ipc(message) {
        messages.push(message);
        if (message?.done) resolve(messages);
      },
      onExit(_subprocess, exitCode, signalCode) {
        reject(new Error(`child exited (${exitCode}, ${signalCode}) after ${messages.length} messages`));
      },
    });
    const received = await promise;
    const userCmd = received.filter(message => message?.cmd === "USER_CMD");
    expect(userCmd).toHaveLength(1);
    expect(Buffer.isBuffer(userCmd[0].payload)).toBe(true);
    expect(userCmd[0].payload.toString()).toBe("through-dispatch");
    // The NODE_HANDLE message is protocol traffic, not a user message.
    expect(received.filter(message => message?.cmd === "NODE_HANDLE")).toHaveLength(0);
    // And no raw [message, buffers] envelope may leak through.
    expect(received.filter(message => Array.isArray(message))).toHaveLength(0);
  });

  it("a message_len that overflows header_length + message_len does not crash the receiver", async () => {
    // The advanced IPC framing is [u8 type][u32-le length][payload]. Decoding previously
    // checked `data.len < header_length + message_len`, which is u32 arithmetic: a child
    // sending length 0xFFFFFFFB makes the sum wrap to 0, the guard passes, and the receiver
    // slices `data[5..0]` (length ~SIZE_MAX) straight into the deserializer.
    //
    // Run the receiver in its own subprocess so a crash is observed as a failing
    // assertion here rather than taking out the test runner.
    // prettier-ignore
    const parent = `
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          // type = SerializedMessage (0x02), length = 0xFFFFFFFB (little-endian).
          // header_length (5) + 0xFFFFFFFB wraps to 0 in u32.
          'require("fs").writeSync(3, Buffer.from([0x02, 0xfb, 0xff, 0xff, 0xff]))',
        ],
        stdio: ["ignore", "inherit", "inherit"],
        serialization: "advanced",
        ipc(msg) { console.error("UNEXPECTED_IPC_MESSAGE", msg); },
      });
      await child.exited;
      console.log("PARENT_OK");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parent],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("PARENT_OK");
    expect(stderr).not.toContain("UNEXPECTED_IPC_MESSAGE");
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)(
    "closes the channel when a frame declares a length that cannot be framed with its header",
    async () => {
      const parent = `
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          'process.on("disconnect", () => process.exit(42)); require("fs").writeSync(3, Buffer.from([0x02, 0xff, 0xff, 0xff, 0xff]));',
        ],
        stdio: ["ignore", "inherit", "inherit"],
        serialization: "advanced",
        ipc(msg) { console.error("UNEXPECTED_IPC_MESSAGE", msg); },
      });
      console.log("CHILD_EXIT", await child.exited);
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", parent],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("CHILD_EXIT 42");
      expect(stderr).not.toContain("UNEXPECTED_IPC_MESSAGE");
      expect(exitCode).toBe(0);
    },
  );
});

// getIPCInstance error path: on Windows, windowsConfigureClient can open the
// pipe, set socket=.open, then fail readStart — at which point closeSocket
// queued an _onAfterIPCClosed task holding *SendQueue, and instance.deinit()
// (previously TrivialDeinit) freed it without cancelling. IPCInstance.deinit
// now runs SendQueue.deinit() so the tracked after_close_task is cancelled on
// both platforms before the allocation is released.
it("child with unusable NODE_CHANNEL_FD tears down IPC without crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.on('error', e => console.log('err', e.code));
        process.send('x');
        setImmediate(() => setImmediate(() => console.log('ok')));
      `,
    ],
    env: {
      ...bunEnv,
      NODE_CHANNEL_FD: "921",
      NODE_CHANNEL_SERIALIZATION_MODE: "json",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("Unable to start IPC");
  expect(stdout).toBe("err ERR_IPC_CHANNEL_CLOSED\nok\n");
  expect(exitCode).toBe(0);
});

it.skipIf(isWindows)("advanced serialization advertises wire format version 2", async () => {
  // The version packet is the first frame on the channel:
  // [type=Version(1), u32 LE version]. Read it raw off fd 3 before the
  // child's own channel machinery starts consuming the socket.
  await using child = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const fs = require("fs");
      const buf = Buffer.alloc(5);
      let n = 0;
      while (n < 5) {
        try {
          n += fs.readSync(3, buf, n, 5 - n);
        } catch (e) {
          if (e.code !== "EAGAIN") throw e;
        }
      }
      console.log(JSON.stringify([...buf]));`,
    ],
    env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
    serialization: "advanced",
    ipc() {},
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  expect(JSON.parse(stdout.trim())).toEqual([1, 2, 0, 0, 0]);
  expect(exitCode).toBe(0);
});

// The peer hand-rolls the sendmsg(2) so it can attach three descriptors to one
// NODE_HANDLE message, which neither Bun nor libuv ever do. The receiver (this
// test process) has to use the first one and close the others. The peer keeps
// the far ends of the two extras, so EOF on those proves we closed our copies;
// that part can only fail on macOS, where descriptors that do not fit the
// receiver's control buffer are installed anyway and leak (Linux drops them in
// the kernel). The close-on-exec check covers both platforms.
const scmRightsPeerSource = `
const { dlopen, FFIType, ptr } = require("bun:ffi");
const isDarwin = process.platform === "darwin";
const libc = dlopen(process.env.LIBC_PATH, {
  socket: { args: [FFIType.int, FFIType.int, FFIType.int], returns: FFIType.int },
  socketpair: { args: [FFIType.int, FFIType.int, FFIType.int, FFIType.ptr], returns: FFIType.int },
  sendmsg: { args: [FFIType.int, FFIType.ptr, FFIType.int], returns: FFIType.i64_fast },
  recv: { args: [FFIType.int, FFIType.ptr, FFIType.u64, FFIType.int], returns: FFIType.i64_fast },
  close: { args: [FFIType.int], returns: FFIType.int },
});
const AF_UNIX = 1, AF_INET = 2, SOCK_STREAM = 1, SOCK_DGRAM = 2;
const SOL_SOCKET = isDarwin ? 0xffff : 1;
const SCM_RIGHTS = 1;
const MSG_DONTWAIT = isDarwin ? 0x80 : 0x40;

function socketpair() {
  const fds = new Int32Array(2);
  if (libc.symbols.socketpair(AF_UNIX, SOCK_STREAM, 0, fds) !== 0) throw new Error("socketpair() failed");
  return fds;
}

// fds[0] is the handle the message describes; the receiver must close the rest.
const udp = libc.symbols.socket(AF_INET, SOCK_DGRAM, 0);
if (udp < 0) throw new Error("socket() failed");
const [extraA, keptA] = socketpair();
const [extraB, keptB] = socketpair();
const fds = [udp, extraA, extraB];

const payload = Buffer.from(JSON.stringify({ cmd: "NODE_HANDLE", type: "dgram.Native", message: { hello: "handle" } }) + "\\n");

// struct cmsghdr: Linux { size_t len; int level; int type; } (data 8-aligned),
// Darwin { socklen_t len; int level; int type; } (data 4-aligned). Both are
// little-endian, so 32-bit writes into a zeroed buffer fill the wider fields too.
const cmsgHeader = isDarwin ? 12 : 16;
const cmsgAlign = isDarwin ? 4 : 8;
const cmsgLen = cmsgHeader + 4 * fds.length;
const cmsgSpace = cmsgHeader + Math.ceil((4 * fds.length) / cmsgAlign) * cmsgAlign;
const control = new Uint8Array(cmsgSpace);
const controlView = new DataView(control.buffer);
controlView.setUint32(0, cmsgLen, true);
controlView.setInt32(isDarwin ? 4 : 8, SOL_SOCKET, true);
controlView.setInt32(isDarwin ? 8 : 12, SCM_RIGHTS, true);
fds.forEach((fd, i) => controlView.setInt32(cmsgHeader + 4 * i, fd, true));

// struct iovec { void *base; size_t len; } is the same on both.
const iov = new Uint8Array(16);
const iovView = new DataView(iov.buffer);
iovView.setBigUint64(0, BigInt(ptr(payload)), true);
iovView.setUint32(8, payload.byteLength, true);

// struct msghdr: name @0, namelen @8, iov @16, iovlen @24 (size_t on Linux, int
// on Darwin), control @32, controllen @40 (size_t on Linux, socklen_t on Darwin
// followed by flags @44), flags @48 on Linux. Zeroed buffer, so the narrower
// Darwin fields and the padding come out right from the same 32-bit writes.
const msg = new Uint8Array(56);
const msgView = new DataView(msg.buffer);
msgView.setBigUint64(16, BigInt(ptr(iov)), true);
msgView.setUint32(24, 1, true);
msgView.setBigUint64(32, BigInt(ptr(control)), true);
msgView.setUint32(40, control.byteLength, true);

// Bun put the IPC channel on fd 3 (no other extra stdio).
const sent = libc.symbols.sendmsg(3, msg, 0);
if (sent !== payload.byteLength) throw new Error("sendmsg() returned " + sent);
// Drop our copies: from here on only the receiver keeps extraA/extraB open, so
// EOF on keptA/keptB means the receiver closed them.
for (const fd of fds) libc.symbols.close(fd);

// Nothing is ever written on these pairs, so recv() is 0 (EOF) once every copy
// of the far end is closed and -1 (EAGAIN) while the receiver still holds one.
process.on("message", () => {
  const probe = new Uint8Array(1);
  const state = fd => (libc.symbols.recv(fd, probe, 1, MSG_DONTWAIT) === 0 ? "closed" : "open");
  process.send({ extras: [state(keptA), state(keptB)] });
});
`;

it.skipIf(isWindows)(
  "a NODE_HANDLE message carrying several descriptors delivers the first and closes the rest",
  async () => {
    using dir = tempDir("ipc-scm-rights", { "peer.js": scmRightsPeerSource });
    const { promise, resolve, reject } = Promise.withResolvers<{ message: unknown; handle: any; peer: unknown }>();
    let first: { message: unknown; handle: any } | undefined;
    await using child = spawn({
      cmd: [bunExe(), "peer.js"],
      cwd: String(dir),
      env: { ...bunEnv, LIBC_PATH: libcPathForDlopen() },
      stdio: ["ignore", "inherit", "inherit"],
      serialization: "json",
      ipc(message, subprocess, handle) {
        if (!first) {
          first = { message, handle };
          // By the time the handle reaches us the receive path has already dealt
          // with the other descriptors, so the peer can check its ends now.
          subprocess.send("probe");
        } else {
          resolve({ ...first, peer: message });
        }
      },
      onExit(_subprocess, exitCode, signalCode) {
        reject(new Error(`peer exited (${exitCode}, ${signalCode}) before reporting`));
      },
    });
    const { message, handle, peer } = await promise;

    // `handle` is the dgram wrap Bun built around the first descriptor, so
    // handle.fd is that descriptor as received into this process.
    const F_GETFD = 1;
    const FD_CLOEXEC = 1;
    const libc = dlopen(libcPathForDlopen(), { fcntl: { args: ["int", "int"], returns: "int" } });
    const fdFlags = libc.symbols.fcntl(handle.fd, F_GETFD);
    libc.close();
    handle.close();

    expect({ message, peer, cloexec: fdFlags & FD_CLOEXEC }).toEqual({
      message: { hello: "handle" },
      peer: { extras: ["closed", "closed"] },
      cloexec: FD_CLOEXEC,
    });
  },
);
