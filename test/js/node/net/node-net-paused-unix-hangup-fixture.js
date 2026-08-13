// N clients over an AF_UNIX allowHalfOpen server each write a tail and close while the accepted socket is still
// paused (pauseOnConnect). The server stays paused for an idle window after every peer is gone (this is where an
// unhandled EPOLLHUP spins), reports whether the loop stayed idle, then resumes and expects tail+end+close each.
const net = require("node:net");

const N = 4;
const WINDOW_MS = 1000;
const results = {};
const sockets = [];
let peersGone = 0;
let closed = 0;
let verdict;

function report() {
  if (closed !== N || verdict === undefined) return;
  const sorted = Object.fromEntries(Object.keys(results).sort().map(k => [k, results[k]]));
  console.log(JSON.stringify(sorted));
  console.log(verdict);
  server.close();
}

function maybeMeasure() {
  if (peersGone !== N || sockets.length !== N) return;
  const cpu0 = process.cpuUsage();
  setTimeout(() => {
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    // A spin burns >= the whole window; half leaves room for GC on debug/ASAN builds.
    verdict = cpuMs < WINDOW_MS / 2 ? "idle" : "spun " + Math.round(cpuMs) + "ms cpu in " + WINDOW_MS + "ms";
    for (const socket of sockets) socket.resume();
    report();
  }, WINDOW_MS);
}

const server = net.createServer({ allowHalfOpen: true, pauseOnConnect: true }, socket => {
  const r = { data: "", ends: 0, closes: 0 };
  socket.setEncoding("utf8");
  socket.on("data", chunk => (r.data += chunk));
  socket.on("error", err => (r.error = err.code || String(err)));
  socket.on("end", () => {
    r.ends++;
    socket.end();
  });
  socket.on("close", () => {
    r.closes++;
    results[r.data.trim() || "socket-" + closed] = r;
    closed++;
    report();
  });
  sockets.push(socket);
  maybeMeasure();
});

server.listen(process.env.SOCK, () => {
  for (let i = 0; i < N; i++) {
    const client = net.connect(process.env.SOCK, () => {
      client.end("tail-" + i + "\n", () => client.destroy());
    });
    client.on("error", err => {
      console.error("client " + i + " error: " + (err.code || err));
      process.exitCode = 1;
    });
    client.on("close", () => {
      peersGone++;
      maybeMeasure();
    });
  }
});
