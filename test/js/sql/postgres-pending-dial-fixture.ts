// A dial to an IP literal is a socket from its first moment, and uSockets reports
// nothing when the application closes such a socket before it opens. Each mode
// leaves the process with one dial that never completes, and the process has to
// exit on its own once that dial times out.
//
//   connect  the dial of the session itself
//   cancel   the dial of the connection that cancel() opens for a running query
//
// The listener is a raw libc socket. Its backlog holds one connection, which no
// listener of Bun can ask for, and nothing accepts from it unless this file does.
// With the backlog full the kernel drops every SYN.
import { SQL } from "bun";
import { dlopen, ptr } from "bun:ffi";
import net from "node:net";
import { pgAuthenticationOk, pgBackendKeyData, pgReadyForQuery } from "./wire-frames";

const darwin = process.platform === "darwin";
const libc = dlopen(darwin ? "libSystem.B.dylib" : "libc.so.6", {
  socket: { args: ["int", "int", "int"], returns: "int" },
  bind: { args: ["int", "ptr", "int"], returns: "int" },
  listen: { args: ["int", "int"], returns: "int" },
  getsockname: { args: ["int", "ptr", "ptr"], returns: "int" },
  accept: { args: ["int", "ptr", "ptr"], returns: "int" },
  poll: { args: ["ptr", "u64", "int"], returns: "int" },
  read: { args: ["int", "ptr", "usize"], returns: "int" },
  write: { args: ["int", "ptr", "usize"], returns: "int" },
  close: { args: ["int"], returns: "int" },
}).symbols;

const AF_INET = 2;
const SOCK_STREAM = 1;
const POLLIN = 1;

const address = new Uint8Array(16);
if (darwin) {
  address[0] = 16;
  address[1] = AF_INET;
} else {
  new DataView(address.buffer).setUint16(0, AF_INET, true);
}
address.set([127, 0, 0, 1], 4);
const listener = libc.socket(AF_INET, SOCK_STREAM, 0);
// The smallest backlog that admits one connection: macOS reads 0 as no limit.
if (listener < 0 || libc.bind(listener, ptr(address), 16) !== 0 || libc.listen(listener, darwin ? 1 : 0) !== 0) {
  throw new Error("listen failed");
}
if (libc.getsockname(listener, ptr(address), ptr(new Uint32Array([16]))) !== 0) {
  throw new Error("getsockname failed");
}
const port = (address[2] << 8) | address[3];
const url = `postgres://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;

/** Resolves once a read of `fd`, or an accept from it, does not block. */
async function readable(fd: number) {
  const pollfd = new DataView(new ArrayBuffer(8));
  pollfd.setInt32(0, fd, true);
  pollfd.setInt16(4, POLLIN, true);
  while (libc.poll(ptr(pollfd), 1, 0) === 0) await new Promise(resolve => setImmediate(resolve));
}

/** From here on the kernel answers no SYN for `port`. */
async function fillBacklog() {
  const filler = net.connect(port, "127.0.0.1");
  await new Promise((resolve, reject) => filler.on("connect", resolve).on("error", reject));
  return filler;
}

const code = (query: Promise<unknown>) =>
  query.then(
    () => "resolved",
    err => err.code,
  );

if (process.argv[2] === "connect") {
  const filler = await fillBacklog();
  // Nothing has to succeed within the timeout, so it can be short.
  const sql = new SQL({ url, max: 1, connectionTimeout: 0.2 });
  console.log(await code(sql`select 1`));
  filler.destroy();
} else {
  const sql = new SQL({ url, max: 1, connectionTimeout: 1 });
  const query = sql`select pg_sleep(10)`.simple();
  const settled = code(query);

  await readable(listener);
  const session = libc.accept(listener, null, null);
  if (session < 0) throw new Error("accept failed");
  const handshake = Buffer.concat([pgAuthenticationOk(), pgBackendKeyData(4242, 13371337), pgReadyForQuery()]);
  if (libc.write(session, ptr(handshake), handshake.length) !== handshake.length) throw new Error("write failed");

  // The startup message, then the query: Byte1('Q') Int32(length) String. With
  // the whole query read, the query is the one the backend runs.
  const received = Buffer.alloc(4096);
  let length = 0;
  const queryReceived = () => {
    if (length < 4) return false;
    const query = received.readUInt32BE(0);
    return length >= query + 5 && length >= query + 1 + received.readUInt32BE(query + 1);
  };
  while (!queryReceived()) {
    await readable(session);
    const read = libc.read(session, ptr(received, length), received.length - length);
    if (read <= 0) throw new Error("the client closed the session");
    length += read;
  }

  const filler = await fillBacklog();
  query.cancel();
  // The backend goes away. The cancel connection is still in its dial.
  libc.close(session);
  console.log(await settled);
  filler.destroy();
}
