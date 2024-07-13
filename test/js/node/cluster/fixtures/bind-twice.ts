// This test starts two clustered HTTP servers on the same port. It expects the
// first cluster to succeed and the second cluster to fail with EADDRINUSE.
//
// The test may seem complex but most of it is plumbing that routes messages
// from the child processes back to the supervisor. As a tree it looks something
// like this:
//
//          <supervisor>
//         /            \
//    <primary 1>     <primary 2>
//       /                \
//  <worker 1>         <worker 2>
//
// The first worker starts a server on a fixed port and fires a ready message
// that is routed to the second worker. When it tries to bind, it expects to
// see an EADDRINUSE error.
//
// See https://github.com/joyent/node/issues/2721 for more details.

const assert = require("assert");
const cluster = require("cluster");
const fork = require("child_process").fork;
const http = require("http");
const { mustNotCall } = require("../common");

const id = process.argv[2];

if (!id) {
  const a = fork(__filename, ["one"]);
  const b = fork(__filename, ["two"]);

  a.on("exit", c => {
    if (c) {
      b.send("QUIT");
      throw new Error(`A exited with ${c}`);
    }
  });

  b.on("exit", c => {
    if (c) {
      a.send("QUIT");
      throw new Error(`B exited with ${c}`);
    }
  });

  a.on("message", m => {
    assert.strictEqual(m.msg, "READY");
    b.send({ msg: "START", port: m.port });
  });

  b.on("message", m => {
    assert.strictEqual(m, "EADDRINUSE");
    a.send("QUIT");
    b.send("QUIT");
  });
} else if (id === "one") {
  if (cluster.isPrimary) return startWorker();

  const server = http.createServer(mustNotCall());
  server.listen(0, () => {
    process.send({ msg: "READY", port: server.address().port });
  });

  process.on("message", m => {
    if (m === "QUIT") process.exit();
  });
} else if (id === "two") {
  if (cluster.isPrimary) return startWorker();

  const server = http.createServer(mustNotCall());
  process.on("message", m => {
    if (m === "QUIT") process.exit();
    assert.strictEqual(m.msg, "START");
    server.listen(m.port, mustNotCall());
    server.on("error", e => {
      assert.strictEqual(e.code, "EADDRINUSE");
      process.send(e.code);
    });
  });
} else {
  assert(0); // Bad command line argument
}

function startWorker() {
  const worker = cluster.fork();
  worker.on("exit", process.exit);
  worker.on("message", process.send.bind(process));
  process.on("message", worker.send.bind(worker));
}
