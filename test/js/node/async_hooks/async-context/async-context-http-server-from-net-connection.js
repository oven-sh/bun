process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");
const net = require("net");

// An http.Server that is handed a socket with emit("connection") parses it in the async context of that call. What the
// parser reports ('request' and the request's events, 'upgrade', 'connect', the 'clientError' of a parse error) runs
// there: not in the store of the net.Server's listen(), and not in the socket's own context, which has no store.
// What the socket's 'end' reports (a message cut short) runs in the socket's context.
const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

function expectStore(what, expected) {
  const store = asyncLocalStorage.getStore();
  if (store !== expected) {
    console.error(`FAIL: ${what} ran in ${JSON.stringify(store)}, expected ${JSON.stringify(expected)}`);
    failed = true;
  }
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// One net.Server for each way to hand a socket over. Both listen in the same store.
const handOvers = [
  { how: "in the 'connection' event", store: "listen", emit: socket => httpServer.emit("connection", socket) },
  {
    how: "in a store of its own",
    store: "hand over",
    emit: socket => asyncLocalStorage.run("hand over", () => httpServer.emit("connection", socket)),
  },
];
// What each client sends, and what the server has to see of it.
const exchanges = {
  "a request": [
    "POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 5\r\n\r\nhello",
    "request,data,end",
  ],
  "an upgrade": ["GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n", "upgrade"],
  "a CONNECT": ["CONNECT x:1 HTTP/1.1\r\nHost: x:1\r\n\r\n", "connect"],
  "a bad header": ["GET / HTTP/1.1\r\nHost: x\r\nBad Header\r\n\r\n", "HPE_INVALID_HEADER_TOKEN"],
  "a body cut short": [
    "POST /cut-short HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nhel",
    "request,HPE_INVALID_EOF_STATE",
  ],
};

// The client of each exchange and what the server saw of it. The socket tells how it was handed over, and the event
// tells which exchange it is.
const records = {};
const recordOf = (what, socket) => records[`${what}, handed over ${socket.handOver.how}`];

const httpServer = http.createServer((request, response) => {
  const cutShort = request.url === "/cut-short";
  const { name, seen, client } = recordOf(cutShort ? "a body cut short" : "a request", request.socket);
  const { store } = request.socket.handOver;
  expectStore(`${name}: 'request'`, store);
  seen.push("request");
  if (cutShort) return client.end();
  request.on("data", () => {
    expectStore(`${name}: the request's 'data'`, store);
    seen.push("data");
  });
  request.on("end", () => {
    expectStore(`${name}: the request's 'end'`, store);
    seen.push("end");
    response.end("ok");
  });
});
// Node 22 runs 'upgrade' and 'connect' in no store. Its AsyncLocalStorage does not follow the parser there.
const parserHandsOver = Number(process.versions.node.split(".")[0]) >= 24;
httpServer.on("upgrade", (request, socket) => {
  const { name, seen } = recordOf("an upgrade", socket);
  if (parserHandsOver) expectStore(`${name}: 'upgrade'`, socket.handOver.store);
  seen.push("upgrade");
  socket.destroy();
});
httpServer.on("connect", (request, socket) => {
  const { name, seen } = recordOf("a CONNECT", socket);
  if (parserHandsOver) expectStore(`${name}: 'connect'`, socket.handOver.store);
  seen.push("connect");
  socket.destroy();
});
httpServer.on("clientError", (err, socket) => {
  // The parser found the bad header in the socket's 'data'. The end of the input is the socket's 'end'.
  const fromEnd = err.code === "HPE_INVALID_EOF_STATE";
  const { name, seen } = recordOf(fromEnd ? "a body cut short" : "a bad header", socket);
  expectStore(`${name}: 'clientError' (${err.code})`, fromEnd ? undefined : socket.handOver.store);
  seen.push(err.code);
  socket.destroy();
});

function listen(handOver) {
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      expectStore("the net.Server's 'connection'", "listen");
      socket.handOver = handOver;
      handOver.emit(socket);
    });
    asyncLocalStorage.run("listen", () => server.listen(0, "127.0.0.1", () => resolve(server)));
  });
}

function exchange(server, handOver, what) {
  return new Promise(resolve => {
    const [payload, expected] = exchanges[what];
    const name = `${what}, handed over ${handOver.how}`;
    // In no store, so that the accepted socket's own events have none.
    const client = asyncLocalStorage.exit(() => net.connect(server.address().port, "127.0.0.1"));
    const seen = [];
    records[name] = { name, seen, client };
    client.on("connect", () => client.write(payload));
    client.on("error", () => {});
    client.on("close", () => {
      if (String(seen) !== expected) fail(`${name}: the server had ${seen}, expected ${expected}`);
      resolve();
    });
    client.resume();
  });
}

(async () => {
  const servers = await Promise.all(handOvers.map(listen));
  await Promise.all(
    handOvers.flatMap((handOver, i) => Object.keys(exchanges).map(what => exchange(servers[i], handOver, what))),
  );
  for (const server of servers) server.close();
  process.exit(failed ? 1 : 0);
})();
