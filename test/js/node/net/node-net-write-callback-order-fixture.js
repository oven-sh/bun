// The callback of a write that did not fit in the kernel's buffer runs after the callbacks of the writes before it.
// Runs unchanged under node, but for `fd`:
//   node node-net-write-callback-order-fixture.js <client|server> <tcp|unix> <connect|ready|listener|connection|paused-connection> [unix path]
//   bun node-net-write-callback-order-fixture.js fd <libc to dlopen>
// node: {"fitted":true,"callbacks":"in order"}
//
// The writer writes inside the handler that the open of its handle runs, until one write does not fit. It then stays
// in that handler until the reader has read every write that did fit. The rest of the last write fits now, so its
// completion is due as soon as the handler returns.
// The reader is on another thread. For `fd` it is the handler itself: `socket.connect({ fd })` opens one end of a
// socketpair(2), made through bun:ffi, and the handler reads the other end.
const { Worker, isMainThread, workerData, parentPort } = require("node:worker_threads");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fail(message) {
  console.error(message);
  process.exit(1);
}

// `read(bytes)` returns once the reader has read that many. `done()` lets the process end.
function writeUntilOneDoesNotFit(socket, chunkSize, read, done) {
  const order = [];
  const chunk = Buffer.alloc(chunkSize, 97);
  let writes = 0;
  do {
    const index = writes++;
    socket.write(chunk, err => order.push(err ? `${index}:${err.code}` : index));
    if (writes * chunkSize > 64 * 1024 * 1024) fail("the kernel's buffer never filled");
  } while (socket.writableLength === 0);

  // Stay in this handler until the reader has taken every write that fit.
  const fitted = (writes - 1) * chunkSize;
  read(fitted);

  socket.end(() => {
    const inOrder = order.length === writes && order.every((value, index) => value === index);
    const callbacks = inOrder ? "in order" : { ran: `${order.length} of ${writes}`, first: order.slice(0, 4) };
    console.log(JSON.stringify({ fitted: fitted > 0, callbacks }));
    socket.destroy();
    done();
  });
}

if (!isMainThread) {
  // The reader: reads nothing until told to, then counts the bytes where the writer's thread can see them.
  const received = new Int32Array(workerData.received);
  let socket;
  let told = false;
  const read = () => {
    if (!socket || !told) return;
    socket.on("data", chunk => {
      Atomics.add(received, 0, chunk.length);
      Atomics.notify(received, 0);
    });
    socket.resume();
  };
  parentPort.on("message", () => {
    told = true;
    read();
  });
  const adopt = s => {
    socket = s;
    s.on("error", () => {});
    s.on("end", () => s.end());
    read();
  };
  if (workerData.connectTo !== undefined) {
    const s = net.connect(workerData.connectTo);
    s.pause();
    adopt(s);
  } else {
    const server = net.createServer({ pauseOnConnect: true }, s => {
      server.close();
      adopt(s);
    });
    server.listen(workerData.listenOn, () => parentPort.postMessage(server.address()));
  }
} else if (process.argv[2] === "fd") {
  const { dlopen, FFIType, ptr } = require("bun:ffi");
  const { symbols } = dlopen(process.argv[3], {
    socketpair: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  });
  const AF_UNIX = 1;
  const SOCK_STREAM = 1;
  const fds = new Int32Array(2);
  if (symbols.socketpair(AF_UNIX, SOCK_STREAM, 0, ptr(fds)) !== 0) fail("socketpair() failed");

  const scratch = Buffer.alloc(64 * 1024);
  const read = bytes => {
    for (let seen = 0; seen < bytes;) seen += fs.readSync(fds[1], scratch);
  };
  const socket = new net.Socket();
  socket.on("error", err => fail(err.stack));
  socket.once("connect", () => writeUntilOneDoesNotFit(socket, 1024, read, () => fs.closeSync(fds[1])));
  socket.connect({ fd: fds[0] });
} else {
  const [role, transport, where, unixPath] = process.argv.slice(2);
  // Under what every kernel takes at once: a unix socket of macOS holds 8 KB.
  const chunkSize = transport === "unix" ? 1024 : 16 * 1024;
  const received = new Int32Array(new SharedArrayBuffer(4));
  const address =
    transport === "unix"
      ? (unixPath ?? path.join(os.tmpdir(), `write-callback-order-${process.pid}.sock`))
      : { port: 0, host: "127.0.0.1" };
  let reader;

  const read = bytes => {
    reader.postMessage("read");
    for (let seen; (seen = Atomics.load(received, 0)) < bytes;) {
      if (Atomics.wait(received, 0, seen, 30_000) === "timed-out") fail(`the reader stopped at ${seen} of ${bytes}`);
    }
  };
  const opened = socket => {
    socket.on("error", err => fail(err.stack));
    writeUntilOneDoesNotFit(socket, chunkSize, read, () => reader.terminate());
  };

  if (role === "client") {
    reader = new Worker(__filename, { workerData: { received: received.buffer, listenOn: address } });
    reader.once("message", listening => {
      const target = transport === "unix" ? address : { port: listening.port, host: "127.0.0.1" };
      const socket = where === "listener" ? net.connect(target, onOpen) : net.connect(target).once(where, onOpen);
      function onOpen() {
        opened(socket);
      }
    });
  } else {
    const server = net.createServer({ pauseOnConnect: where === "paused-connection" }, socket => {
      server.close();
      opened(socket);
    });
    server.listen(address, () => {
      const connectTo = transport === "unix" ? address : { port: server.address().port, host: "127.0.0.1" };
      reader = new Worker(__filename, { workerData: { received: received.buffer, connectTo } });
    });
  }
}
