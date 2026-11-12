// send(message, socket) on a socket that still has writes queued: one handoff per case, and one line
// of JSON for each with what the sender's socket reported. The arguments name the cases to run
// (default: all). The working directory gets a unix socket. Runs under node too.
"use strict";
const net = require("node:net");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { join } = require("node:path");

const CHUNK = Buffer.alloc(1 << 18, "w");

function fail(message) {
  console.error(message);
  process.exit(1);
}
// A child that nothing here killed has no reason to exit before this process does.
const killed = new Set();
function child(file, options) {
  const it = fork(join(__dirname, file), [], options);
  it.on("exit", (code, signal) => killed.has(it) || fail(`${file} exited: ${signal ?? code}`));
  return it;
}
function kill(it) {
  killed.add(it);
  it.kill("SIGKILL");
}
const startReceiver = () =>
  child("child-process-sent-socket-receiver.js", { stdio: ["pipe", "inherit", "inherit", "ipc"] });
// The receiver is a child that this process tells when to ack, or the parent, which whoever runs
// the parent tells ("ack" on stdout).
let receiver = process.send ? process : startReceiver();
if (receiver === process) process.on("disconnect", () => fail("the parent closed the channel"));
const tellReceiverToAck = () => (receiver === process ? process.stdout.write("ack\n") : receiver.stdin.write("x"));
async function killReceiver() {
  kill(receiver);
  await once(receiver, "exit");
}
// Neither end of a connection reads until a case tells it to (pauseOnConnect, and pause() before
// 'connect'). A unix socket then holds a fixed amount, so a chunk that is left in flight stays in
// flight. TCP's buffers grow for a while, so only the cases that need TCP use it.
// One server for each kind of connection, made when a case first asks for it.
const servers = {};
const serve = {
  unix: () => net.createServer({ pauseOnConnect: true }).listen("s.sock"),
  tcp: () => net.createServer({ pauseOnConnect: true }).listen(0, "127.0.0.1"),
  // Its 'connection' sockets are a kind of their own: the server reads them, not a net.Server.
  // node:http loads here and not at the top: it costs a debug build a third of a second.
  http: () => require("node:http").createServer().listen("h.sock"),
};
async function listening(transport) {
  const server = (servers[transport] ??= serve[transport]());
  if (!server.listening) await once(server, "listening");
}
const dial = transport =>
  (transport === "tcp"
    ? net.connect(servers.tcp.address().port, "127.0.0.1")
    : net.connect(transport === "http" ? "h.sock" : "s.sock")
  ).pause();

const turnOfTheLoop = () => new Promise(resolve => setImmediate(resolve));

// The ack closes the sent handle. The receiver's answer follows its ack, and two turns of the loop
// later everything that close set off has run.
async function acked() {
  const answered = once(receiver, "message");
  tellReceiverToAck();
  await answered;
  await turnOfTheLoop();
  await turnOfTheLoop();
}

// The peer reads `bytes`: the sender wrote the last of them before the read that completes this.
function received(peer, bytes) {
  return new Promise(resolve => {
    let got = 0;
    peer.on("data", chunk => {
      got += chunk.length;
      if (got === bytes) setImmediate(resolve);
    });
    peer.resume();
  });
}

// What a reset of the peer or the death of the receiver sets off in the sender comes with a later
// event of the loop. A build that never settles the writes shows it after two seconds.
async function untilDestroyed(socket) {
  for (const deadline = Date.now() + 2000; !socket.destroyed && Date.now() < deadline;) await turnOfTheLoop();
}

// [the socket to send, its peer]
async function connection(origin, transport = "unix") {
  await listening(transport);
  const dialed = dial(transport);
  const [[accepted]] = await Promise.all([once(servers[transport], "connection"), once(dialed, "connect")]);
  let pair = origin === "dialed" ? [dialed, accepted] : [accepted, dialed];
  if (origin === "adopted") {
    // A socket that arrived over a channel: the receiver gets the accepted one and sends it
    // straight back. It reads its channel freely for that, and "wait" puts it back to waiting.
    tellReceiverToAck();
    receiver.send("bounce", accepted);
    pair = [(await once(receiver, "message"))[1], dialed];
    receiver.send("wait");
    await once(receiver, "message");
  }
  pair[1].on("error", () => {});
  return pair;
}

const shape = err => (err.syscall ? `${err.syscall} ${err.code}` : err.code);

// Everything the sender's socket reports, in order.
function watch(socket) {
  const log = [];
  const errors = new Set();
  socket.on("error", err => {
    errors.add(err);
    log.push(`error: ${shape(err)}`);
  });
  socket.on("data", chunk => log.push(`data: ${chunk}`));
  for (const event of ["close", "end", "drain", "finish", "connect"]) socket.on(event, () => log.push(event));
  socket.resume();
  return { log, errors };
}

// The same, for a socket that reads by the time it is sent: resume() reaches the handle a tick later.
async function watching(socket) {
  const seen = watch(socket);
  await turnOfTheLoop();
  return seen;
}

// Writes until a chunk is left in flight, then queues `queued` more behind it.
// Returns the number of chunks that left for the handle (all but the queued ones).
function fill(socket, { log, errors }, queued = 1) {
  let issued = 0;
  let inFlight;
  const write = () => {
    const n = issued++;
    return socket.write(CHUNK, err => {
      // Chunks the kernel took whole are not part of the question.
      if (n < inFlight) return;
      if (err) errors.add(err);
      log.push(`${n === inFlight ? "in flight" : "queued"}: ${err ? shape(err) : "ok"}`);
    });
  };
  while (write()) {}
  inFlight = issued - 1;
  for (let i = 0; i < queued; i++) write();
  return inFlight + 1;
}

const result = (socket, { log, errors }) => ({
  log,
  errorObjects: errors.size,
  writableLength: socket.writableLength,
  destroyed: socket.destroyed,
});

const cases = {};

function handoff(name, { origin = "accepted", transport = "unix", act = "plain", flushesFirst = false }) {
  cases[name] = async () => {
    const [socket, peer] = await connection(origin, transport);
    const seen = await watching(socket);
    const left = fill(socket, seen);
    if (act === "end first") socket.end();
    receiver.send("socket", socket, () => {
      // Node runs this once the message is written, bun at the ack: its place is only known when the handle closes first.
      if (!flushesFirst) seen.log.push("send callback");
    });
    if (act === "destroy") socket.destroy();
    if (act === "end") socket.end();
    if (flushesFirst) await received(peer, left * CHUNK.length);
    await acked();
    peer.destroy();
    return result(socket, seen);
  };
}

for (const origin of ["accepted", "dialed", "adopted"]) {
  for (const act of ["plain", "destroy", "end"]) {
    handoff(`${origin}, ${act}, closes first`, { origin, act });
    handoff(`${origin}, ${act}, flushes first`, { origin, act, flushesFirst: true });
  }
}
handoff("accepted, end first, closes first", { act: "end first" });
handoff("accepted, end first, flushes first", { act: "end first", flushesFirst: true });
handoff("tcp, flushes first", { transport: "tcp", flushesFirst: true });
handoff("http.Server connection, closes first", { transport: "http" });
handoff("http.Server connection, flushes first", { transport: "http", flushesFirst: true });

cases["nothing queued"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = await watching(socket);
  receiver.send("socket", socket);
  await acked();
  peer.destroy();
  return result(socket, seen);
};

cases["one write in flight, flushes first"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = await watching(socket);
  const left = fill(socket, seen, 0);
  receiver.send("socket", socket);
  await received(peer, left * CHUNK.length);
  await acked();
  peer.destroy();
  return result(socket, seen);
};

cases["keepOpen"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = await watching(socket);
  const left = fill(socket, seen);
  receiver.send("socket", socket, { keepOpen: true });
  await received(peer, (left + 1) * CHUNK.length);
  await acked();
  const after = result(socket, seen);
  // When 'drain' comes between two good writes is not the question.
  after.log.sort();
  socket.destroy();
  peer.destroy();
  return after;
};

// Node fails the write with the reset, and which of the two codes it gets is a matter of timing.
const eitherResetCode = line => line.replace(/\b(EPIPE|ECONNRESET)\b/, "EPIPE|ECONNRESET");

cases["tcp, the peer resets before the ack"] = async () => {
  const [socket, peer] = await connection("accepted", "tcp");
  const seen = await watching(socket);
  fill(socket, seen);
  receiver.send("socket", socket);
  peer.resetAndDestroy();
  await untilDestroyed(socket);
  await acked();
  const after = result(socket, seen);
  after.log = after.log.map(eitherResetCode);
  return after;
};

// What the peer wrote is the receiver's to read, and so is the peer's FIN.
cases["tcp, the peer writes, ends and then resets before the ack"] = async () => {
  const [socket, peer] = await connection("accepted", "tcp");
  const seen = await watching(socket);
  fill(socket, seen);
  receiver.send("socket", socket);
  // The bytes and the FIN leave on the tick after end(), and closing with unread data then resets.
  // No turn of the loop in between, so nothing more of the chunk in flight leaves.
  peer.end("for the receiver");
  await new Promise(resolve => process.nextTick(() => process.nextTick(resolve)));
  peer.destroy();
  await untilDestroyed(socket);
  await acked();
  const after = result(socket, seen);
  after.log = after.log.map(eitherResetCode);
  return after;
};

cases["the peer ends before the ack"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = await watching(socket);
  fill(socket, seen);
  receiver.send("socket", socket);
  await new Promise(resolve => peer.end(resolve));
  await turnOfTheLoop();
  await turnOfTheLoop();
  await acked();
  peer.destroy();
  return result(socket, seen);
};

// The sender reads nothing of a connection it gave away, and its close ends nothing for the receiver.
cases["the receiver gets what the peer wrote before the ack"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = await watching(socket);
  receiver.send("echo", socket);
  peer.write("before the ack, ");
  await turnOfTheLoop();
  await turnOfTheLoop();
  await acked();
  peer.write("after it");
  const echoed = await new Promise(resolve => {
    let got = "";
    peer.on("data", chunk => {
      got += chunk;
      if (got.endsWith("after it")) resolve(got);
    });
    peer.resume();
  });
  // The receiver kept the socket and reads its channel freely. This puts it back to waiting.
  receiver.send("wait");
  await once(receiver, "message");
  peer.destroy();
  return { echoed, ...result(socket, seen) };
};

cases["sent from its own 'connect' listener"] = async () => {
  const socket = dial("unix");
  const accepted = once(servers.unix, "connection");
  let seen;
  socket.once("connect", () => {
    seen = watch(socket);
    fill(socket, seen, 0);
    receiver.send("socket", socket);
  });
  const [peer] = await accepted;
  peer.on("error", () => {});
  await once(socket, "connect");
  await acked();
  peer.destroy();
  return result(socket, seen);
};

cases["a sent socket dials again"] = async () => {
  const [socket, peer] = await connection("dialed");
  receiver.send("socket", socket);
  const accepted = once(servers.unix, "connection");
  socket.connect("s.sock");
  await once(socket, "connect");
  socket.write("x");
  const [newPeer] = await accepted;
  newPeer.resume();
  const [chunk] = await once(newPeer, "data");
  await acked();
  socket.destroy();
  peer.destroy();
  return { newPeerGot: String(chunk) };
};

// The socket has one write queue, whichever handle holds the write.
cases["a sent socket with a write in flight dials again"] = async () => {
  const [socket, peer] = await connection("dialed");
  const seen = await watching(socket);
  fill(socket, seen, 0);
  receiver.send("socket", socket);
  const accepted = once(servers.unix, "connection");
  socket.connect("s.sock");
  await once(socket, "connect");
  const [newPeer] = await accepted;
  const closed = new Promise(resolve => socket.once("close", resolve));
  await acked();
  // The close of the new handle takes its own time.
  if (socket.destroyed) await closed;
  const after = result(socket, seen);
  socket.destroy();
  peer.destroy();
  newPeer.destroy();
  return after;
};

// The channel sends one handle at a time: the second waits for the ack of the first.
cases["sent behind a handle that the receiver has not acked"] = async () => {
  const [first, firstPeer] = await connection("accepted");
  const [socket, peer] = await connection("accepted");
  const seen = await watching(socket);
  receiver.send("socket", first);
  fill(socket, seen);
  receiver.send("socket", socket, () => seen.log.push("send callback"));
  await acked();
  await acked();
  firstPeer.destroy();
  peer.destroy();
  return result(socket, seen);
};

// The receiver does not survive the last two cases. The case after one of them gets a new receiver.
cases["the receiver dies before the ack"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = await watching(socket);
  fill(socket, seen);
  receiver.send("socket", socket);
  await killReceiver();
  await untilDestroyed(socket);
  const after = result(socket, seen);
  after.writableLength /= CHUNK.length;
  peer.destroy();
  return after;
};

// The channel never wrote this handle: it waited for the ack of the one before it.
cases["the receiver dies with the handle still in the channel's queue"] = async () => {
  const [first, firstPeer] = await connection("accepted");
  const [socket, peer] = await connection("accepted");
  const seen = await watching(socket);
  receiver.send("socket", first);
  fill(socket, seen);
  receiver.send("socket", socket);
  await killReceiver();
  await untilDestroyed(socket);
  const after = result(socket, seen);
  after.writableLength /= CHUNK.length;
  firstPeer.destroy();
  peer.destroy();
  return after;
};

(async () => {
  await listening("unix");
  const only = process.argv.slice(2);
  for (const [name, run] of Object.entries(cases)) {
    if (only.length && !only.includes(name)) continue;
    if (killed.has(receiver)) receiver = startReceiver();
    console.log(JSON.stringify({ name, ...(await run()) }));
  }
  if (receiver !== process && !killed.has(receiver)) kill(receiver);
  // A parent that waits to be told to ack never sees this process exit otherwise.
  else await new Promise(resolve => process.stdout.write("ack\n", resolve));
  process.exit(0);
})();
