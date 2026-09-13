// Server process for node-http-aborted-request-gc.test.ts.
//
// Every request is answered only after its client has gone away. The IncomingMessage and
// the socket of each request are tracked with a WeakRef. "GET /report" waits until every
// tracked request has closed, runs a full GC, and answers with the number of tracked
// objects that are still alive. The process must do nothing else before it serves
// requests: which Map or Set the engine leaks depends on allocation order.
const http = require("node:http");

const requests = [];
const sockets = [];
let handled = 0;
let closed = 0;

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const alive = refs => refs.reduce((count, ref) => count + (ref.deref() !== undefined ? 1 : 0), 0);

async function report(res) {
  while (closed < handled) await nextTurn();
  for (let i = 0; i < 2; i++) {
    await nextTurn();
    Bun.gc(true);
  }
  res.end(JSON.stringify({ handled, closed, aliveRequests: alive(requests), aliveSockets: alive(sockets) }));
  server.close();
}

const server = http.createServer((req, res) => {
  if (req.url === "/report") {
    report(res);
    return;
  }
  handled++;
  requests.push(new WeakRef(req));
  sockets.push(new WeakRef(req.socket));
  req.once("close", () => {
    closed++;
    res.end("too late");
  });
});

server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
});
