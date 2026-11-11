// send(message, socket) on a socket that still has writes queued: one handoff per case, and one line
// of JSON for each with what the socket reported. The arguments name the cases to run (default: all).
// The working directory gets a unix socket.
"use strict";
const net = require("node:net");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { join } = require("node:path");

const CHUNK = Buffer.alloc(1 << 18, "w");
// The receiver is a child that this process tells when to ack, or the parent, which whoever runs
// the parent tells ("ack" on stdout).
const receiver = process.send
  ? process
  : fork(join(__dirname, "child-process-sent-socket-receiver.js"), [], {
      stdio: ["pipe", "inherit", "inherit", "ipc"],
    });
const tellReceiverToAck = () => (receiver === process ? process.stdout.write("ack\n") : receiver.stdin.write("x"));
// Neither end of a connection reads until a case tells it to (pauseOnConnect, and pause() before
// 'connect'). A unix socket then holds a fixed amount, so a chunk that is left in flight stays in
// flight. TCP's buffers grow for a while, so only the cases that need TCP use it.
const servers = {
  unix: net.createServer({ pauseOnConnect: true }).listen("s.sock"),
  tcp: net.createServer({ pauseOnConnect: true }).listen(0, "127.0.0.1"),
};
const dial = transport =>
  (transport === "tcp" ? net.connect(servers.tcp.address().port, "127.0.0.1") : net.connect("s.sock")).pause();
let echo;

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

// What a reset of the peer or the death of the receiver sets off in the sender comes with the next
// events of the loop. A build that never settles the writes gets 1000 turns to show it.
async function untilDestroyed(socket) {
  for (let turns = 0; !socket.destroyed && turns < 1000; turns++) await turnOfTheLoop();
}

// [the socket to send, its peer]
async function connection(origin, transport = "unix") {
  const dialed = dial(transport);
  const [[accepted]] = await Promise.all([once(servers[transport], "connection"), once(dialed, "connect")]);
  let pair = origin === "dialed" ? [dialed, accepted] : [accepted, dialed];
  if (origin === "adopted") {
    // A socket that arrived over a channel: a child gets the accepted one and sends it straight back.
    echo ??= fork(join(__dirname, "child-process-sent-socket-echo.js"));
    echo.send("bounce", accepted);
    pair = [(await once(echo, "message"))[1], dialed];
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
  for (const event of ["close", "end", "drain", "finish"]) socket.on(event, () => log.push(event));
  socket.resume();
  return { log, errors };
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
    const seen = watch(socket);
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

cases["nothing queued"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = watch(socket);
  receiver.send("socket", socket);
  await acked();
  peer.destroy();
  return result(socket, seen);
};

cases["one write in flight, flushes first"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = watch(socket);
  const left = fill(socket, seen, 0);
  receiver.send("socket", socket);
  await received(peer, left * CHUNK.length);
  await acked();
  peer.destroy();
  return result(socket, seen);
};

cases["keepOpen"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = watch(socket);
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

const eitherResetCode = line => line.replace(/\b(EPIPE|ECONNRESET)\b/, "EPIPE|ECONNRESET");

cases["tcp, the peer resets before the ack"] = async () => {
  const [socket, peer] = await connection("accepted", "tcp");
  const seen = watch(socket);
  fill(socket, seen);
  receiver.send("socket", socket);
  peer.resetAndDestroy();
  await untilDestroyed(socket);
  await acked();
  const after = result(socket, seen);
  after.log = after.log.map(eitherResetCode);
  return after;
};

cases["tcp, the peer ends and then resets before the ack"] = async () => {
  const [socket, peer] = await connection("accepted", "tcp");
  const seen = watch(socket);
  fill(socket, seen);
  receiver.send("socket", socket);
  // The FIN leaves on the tick after end(), and closing with unread data then resets. No turn of
  // the loop in between, so nothing more of the chunk in flight leaves.
  peer.end();
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
  const seen = watch(socket);
  fill(socket, seen);
  receiver.send("socket", socket);
  await new Promise(resolve => peer.end(resolve));
  await turnOfTheLoop();
  await turnOfTheLoop();
  await acked();
  peer.destroy();
  return result(socket, seen);
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

cases["send() throws"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = watch(socket);
  fill(socket, seen);
  const cyclic = {};
  cyclic.self = cyclic;
  let threw = false;
  try {
    receiver.send(cyclic, socket);
  } catch {
    threw = true;
  }
  const ranInsideSend = seen.log.length;
  await turnOfTheLoop();
  await turnOfTheLoop();
  peer.destroy();
  return { threw, ranInsideSend, ...result(socket, seen) };
};

// Last: it takes the receiver with it.
cases["the receiver dies before the ack"] = async () => {
  const [socket, peer] = await connection("accepted");
  const seen = watch(socket);
  fill(socket, seen);
  receiver.send("socket", socket);
  receiver.kill("SIGKILL");
  await once(receiver, "exit");
  await untilDestroyed(socket);
  peer.destroy();
  return result(socket, seen);
};

(async () => {
  await Promise.all([once(servers.unix, "listening"), once(servers.tcp, "listening")]);
  const only = process.argv.slice(2);
  for (const [name, run] of Object.entries(cases)) {
    if (only.length && !only.includes(name)) continue;
    console.log(JSON.stringify({ name, ...(await run()) }));
  }
  echo?.kill();
  if (receiver !== process) receiver.kill();
  // A parent that waits to be told to ack never sees this process exit otherwise.
  else await new Promise(resolve => process.stdout.write("ack\n", resolve));
  process.exit(0);
})();
