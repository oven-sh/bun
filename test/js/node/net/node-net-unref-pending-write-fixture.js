// A write that did not fit in the kernel's buffer keeps the process alive after socket.unref() until it completes or
// fails: libuv counts the write in flight whatever the handle holds. Runs unchanged under node:
//   node node-net-unref-pending-write-fixture.js <client|server|paused-server> <when> [reads|destroys|replies] [unix path]
// node: {"callbacks":"all"}
//       {"callbacks":"all, the last one failed","closed":true}   (destroys)
//       {"callbacks":"all","reply":true}                          (replies)
//
// The writer is the socket that dials or the one a server accepts (`paused-server`: with pauseOnConnect). <when>:
//   before, after   it writes until one write does not fit, inside the handler that the open of its handle runs, and
//                   calls unref() before the first write or after the last
//   later           the same writes and then unref(), after that handler
//   dialing         one write of 16 MB and then unref(), while the client dials. `dialing, one byte`: of one byte,
//                   which the kernel takes at once, so after it nothing holds the loop
// Both ends are on this loop and nothing but the write holds it: the listener and the peer are unref'd, so the peer
// acts only while the loop still turns. Which callbacks ran by 'exit' tells whether the write held it.
const net = require("node:net");

const [writerSide, unrefWhen, peerDoes = "reads", unixPath] = process.argv.slice(2);
// Under what every kernel takes at once: a unix socket of macOS holds 8 KB.
const CHUNK = unixPath ? 1024 : 16 * 1024;
const dialing = unrefWhen.startsWith("dialing");
const ran = [];
let writes = 0;
let writer;
let peer;
let parked = false;
let closed = false;
let reply = false;
let heldAfterTheWrite = false;

process.on("exit", () => {
  const failed = ran.filter(entry => typeof entry === "string");
  const callbacks =
    writes < (dialing ? 1 : 2) || ran.length !== writes
      ? `${ran.length} of ${writes}`
      : failed.length === 0
        ? "all"
        : failed.length === 1 && failed[0].startsWith(`${writes - 1}:`)
          ? "all, the last one failed"
          : `all, ${failed.length} failed`;
  const result = { callbacks };
  if (peerDoes === "destroys") result.closed = closed;
  if (peerDoes === "replies") result.reply = reply;
  if (heldAfterTheWrite) result.loop = "held after the write";
  console.log(JSON.stringify(result));
});

function stillHeld() {
  heldAfterTheWrite = true;
  process.exit(1);
}

function writeUntilOneDoesNotFit() {
  writer.on("error", () => {});
  writer.on("close", () => (closed = true));
  if (peerDoes === "replies") {
    // ref() took the hold again, so the process is still here for the byte that the peer sends back.
    writer.on("data", () => {
      reply = true;
      writer.destroy();
      peer.destroy();
    });
  }
  if (unrefWhen === "before") writer.unref();
  const chunk = Buffer.alloc(CHUNK, 97);
  do {
    const index = writes++;
    writer.write(chunk, err => {
      ran.push(err ? `${index}:${err.code}` : index);
      if (index !== writes - 1) return;
      if (peerDoes === "replies") peer.write("!");
      // The write is done, so the socket lets go of the loop again. This timer holds nothing.
      else setTimeout(stillHeld, 2_000).unref();
    });
    if (writes * CHUNK > 64 * 1024 * 1024) {
      console.error("the kernel's buffer never filled");
      process.exit(1);
    }
  } while (writer.writableLength === 0);
  if (unrefWhen !== "before") writer.unref();
  parked = true;
  if (peerDoes === "replies") setImmediate(() => writer.ref());
  // Not in this call: the write has to wait first.
  setImmediate(peerActs);
}

function writeWhileDialing() {
  writer.on("error", () => {});
  writes = 1;
  writer.write(Buffer.alloc(unrefWhen === "dialing" ? 16 * 1024 * 1024 : 1, 97), err => {
    ran.push(err ? `0:${err.code}` : 0);
    setTimeout(stillHeld, 2_000).unref();
  });
  writer.unref();
  parked = true;
}

function peerActs() {
  if (!parked || !peer) return;
  if (peerDoes === "destroys") peer.destroy();
  else peer.resume();
}

function opened(socket, isWriter) {
  if (isWriter) {
    writer = socket;
    if (unrefWhen === "later") setImmediate(writeUntilOneDoesNotFit);
    else writeUntilOneDoesNotFit();
  } else {
    peer = socket;
    peer.on("error", () => {});
    peer.unref();
    peerActs();
  }
}

const writerIsServer = writerSide !== "client";
// The peer reads nothing before it is told to, so an accepted peer starts paused as well.
const server = net.createServer({ pauseOnConnect: writerSide !== "server" }, socket => opened(socket, writerIsServer));
server.unref();
server.listen(unixPath ?? { port: 0, host: "127.0.0.1" }, () => {
  const socket = unixPath ? net.connect(unixPath) : net.connect(server.address().port, "127.0.0.1");
  if (writerIsServer) socket.pause();
  if (dialing) {
    writer = socket;
    writeWhileDialing();
  } else {
    socket.once("connect", () => opened(socket, !writerIsServer));
  }
});
