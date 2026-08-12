// N clients over an AF_UNIX allowHalfOpen server each write a tail and close while the accepted socket is
// still paused (pauseOnConnect); the server resumes only after the peer is gone. Prints per-client results.
const net = require("node:net");

const N = 4;
const results = {};
let closed = 0;
let accepted = 0;
let peersGone = 0;
const sockets = [];

function maybeResume() {
  // Every peer has fully closed and every accepted socket is in hand: the hangup is pending on all of them.
  if (peersGone === N && accepted === N) setImmediate(() => sockets.forEach(s => s.resume()));
}

const server = net.createServer({ allowHalfOpen: true, pauseOnConnect: true }, socket => {
  const r = { data: "", ends: 0, closes: 0 };
  sockets.push(socket);
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
    if (++closed === N) {
      const sorted = Object.fromEntries(Object.keys(results).sort().map(k => [k, results[k]]));
      console.log(JSON.stringify(sorted));
      server.close();
    }
  });
  accepted++;
  maybeResume();
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
      maybeResume();
    });
  }
});
