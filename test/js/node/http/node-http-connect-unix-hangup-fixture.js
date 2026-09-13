// N CONNECT clients over an AF_UNIX listener each destroy() once the server holds the handed-off socket. The
// server keeps its side open for an idle window after every peer is gone (this is where an unhandled EPOLLHUP
// spins), reports whether the loop stayed idle, then ends its side and expects one end + one close per socket.
const http = require("node:http");
const net = require("node:net");

const N = 8;
const WINDOW_MS = 1000;
const clients = new Map();
const held = [];
const counts = {};
let peersGone = 0;
let closed = 0;
let verdict;

function report() {
  if (closed !== N || verdict === undefined) return;
  const sorted = Object.fromEntries(Object.keys(counts).sort().map(k => [k, counts[k]]));
  console.log(JSON.stringify(sorted));
  console.log(verdict);
  server.close();
}

function maybeMeasure() {
  if (peersGone !== N || held.length !== N) return;
  const cpu0 = process.cpuUsage();
  setTimeout(() => {
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    // A spin burns >= the whole window; half leaves room for teardown + GC on debug/ASAN builds.
    verdict = cpuMs < WINDOW_MS / 2 ? "idle" : "spun " + Math.round(cpuMs) + "ms cpu in " + WINDOW_MS + "ms";
    for (const socket of held) if (!socket.destroyed) socket.end();
    report();
  }, WINDOW_MS);
}

const server = http.createServer();
server.on("connect", (req, socket) => {
  const c = (counts[req.url] = { ends: 0, closes: 0 });
  socket.on("error", err => (c.error = err.code || String(err)));
  socket.on("end", () => c.ends++);
  socket.on("close", () => {
    c.closes++;
    closed++;
    report();
  });
  held.push(socket);
  clients.get(req.url).destroy();
  maybeMeasure();
});
server.listen(process.env.SOCK, () => {
  for (let i = 0; i < N; i++) {
    const target = "peer-" + i + ":443";
    const client = net.connect(process.env.SOCK, () => {
      client.write("CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n\r\n");
    });
    client.on("error", err => {
      console.error("client " + target + " error: " + (err.code || err));
      process.exitCode = 1;
    });
    client.on("close", () => {
      peersGone++;
      maybeMeasure();
    });
    clients.set(target, client);
  }
});
