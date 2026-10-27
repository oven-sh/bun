process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");
const net = require("net");

// Windows takes a write of any size at once: no write waits for its socket there, so there is nothing to check.
if (process.platform === "win32") process.exit(0);

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// More than the kernel takes in one call while the peer does not read: the write has to wait for the socket.
const big = Buffer.alloc(8 * 1024 * 1024);

let client;
// The scenario that runs: its name, what its callbacks saw, and whether its write was seen to wait.
let current;

function ran(what, expected) {
  current.seen.push([what, asyncLocalStorage.getStore(), expected]);
  current.settle();
}

// `response` has bytes that wait for the socket, a turn of the loop after its write. If it had none, the scenario
// would pass without a test.
function mustWait(response) {
  if (response.writableLength === 0) fail(`${current.name}: the write did not wait for the socket`);
  current.waited = true;
}

let firstOfTwo;
const handlers = {
  // A write that is queued behind one that waits goes to the socket when that one completes, so it inherits its
  // context. So does the response's 'drain'.
  "/write-behind-write"(response) {
    let left = 3;
    const ranThenEnd = (what, expected) => {
      ran(what, expected);
      if (--left === 0) response.end();
    };
    response.setHeader("Content-Length", big.length + 1);
    response.once("drain", () => ranThenEnd("'drain' of a response whose write waited", "first write"));
    asyncLocalStorage.run("first write", () =>
      response.write(big, () => ranThenEnd("the callback of a response write that waited", "first write")),
    );
    setImmediate(() => {
      mustWait(response);
      asyncLocalStorage.run("second write", () =>
        response.write("z", () => ranThenEnd("the callback of a response write behind one that waited", "first write")),
      );
      client.resume();
    });
  },

  "/end-behind-write"(response) {
    response.setHeader("Content-Length", big.length + 1);
    response.once("finish", () =>
      ran("'finish' of a response whose end(chunk) is behind a write that waited", "write"),
    );
    asyncLocalStorage.run("write", () =>
      response.write(big, () =>
        ran("the callback of a response write that waited, with an end(chunk) behind it", "write"),
      ),
    );
    setImmediate(() => {
      mustWait(response);
      asyncLocalStorage.run("end", () =>
        response.end("z", () => ran("the callback of a response end(chunk) behind a write that waited", "write")),
      );
      client.resume();
    });
  },

  // Node holds a response's write until the tick ends, so an end() in that tick sends it, in its own context.
  "/end-in-the-tick-of-the-write"(response) {
    response.setHeader("Content-Length", big.length);
    response.once("finish", () => ran("'finish' of a response that ends in the tick of a write that waited", "end"));
    asyncLocalStorage.run("write", () =>
      response.write(big, () => ran("the callback of a response write that waited, with end() in its tick", "end")),
    );
    asyncLocalStorage.run("end", () =>
      response.end(() => ran("the callback of a response end() in the tick of a write that waited", "end")),
    );
    setImmediate(() => {
      mustWait(response);
      client.resume();
    });
  },

  // Two requests that came in one packet. The second response goes out behind the first one's write that waits.
  "/first-of-two"(response) {
    firstOfTwo = response;
    asyncLocalStorage.run("first response", () => {
      response.setHeader("Content-Length", big.length);
      response.write(big, () =>
        ran("the callback of a write that waited, of the first of two responses", "first response"),
      );
      response.end(() => ran("the callback of the end() of the first of two responses", "first response"));
    });
  },
  "/second-of-two"(response) {
    asyncLocalStorage.run("second response", () => {
      response.setHeader("Content-Length", big.length);
      response.write(big, () =>
        ran("the callback of a write of a response behind one whose write waited", "first response"),
      );
      response.end(() =>
        ran("the callback of the end() of a response behind one whose write waited", "first response"),
      );
    });
    setImmediate(() => {
      mustWait(firstOfTwo);
      client.resume();
    });
  },

  // The socket ends with two write callbacks still waiting. No 'drain' comes: both run where the first write was issued.
  "/socket-end-behind-write"(response, request) {
    response.setHeader("Content-Length", big.length + 1);
    asyncLocalStorage.run("first write", () =>
      response.write(big, () =>
        ran("the callback of a response write that waited, when the socket ends", "first write"),
      ),
    );
    setImmediate(() => {
      mustWait(response);
      asyncLocalStorage.run("second write", () =>
        response.write("z", () =>
          ran("the callback of a response write behind one that waited, when the socket ends", "first write"),
        ),
      );
      request.socket.end();
      client.resume();
    });
  },

  // The client goes away under a write that waits: that write and the one behind it fail where the first was issued.
  "/client-goes-away"(response) {
    response.setHeader("Content-Length", big.length + 1);
    asyncLocalStorage.run("first write", () =>
      response.write(big, () =>
        ran("the callback of a response write that waited, when the client goes away", "first write"),
      ),
    );
    setImmediate(() => {
      mustWait(response);
      asyncLocalStorage.run("second write", () =>
        response.write("z", () =>
          ran("the callback of a response write behind one that waited, when the client goes away", "first write"),
        ),
      );
      client.destroy();
    });
  },
};

const scenarios = [
  ["a write behind a write that waits", 3, ["/write-behind-write"]],
  ["an end(chunk) behind a write that waits", 3, ["/end-behind-write"]],
  ["an end() in the tick of a write that waits", 3, ["/end-in-the-tick-of-the-write"]],
  ["a response behind one whose write waits", 4, ["/first-of-two", "/second-of-two"]],
  // Only with a connection that the server was handed: that one is the net.Socket the handler ends.
  ["the socket ends behind a write that waits", 2, ["/socket-end-behind-write"], "emit"],
  ["the client goes away under a write that waits", 2, ["/client-goes-away"]],
];

// Sends the requests of one scenario on a connection of its own. It is over when the connection closed and the
// `count` callbacks ran.
function request(entry, port, [name, count, urls]) {
  return new Promise(resolve => {
    let closed = false;
    current = {
      name: `${entry}: ${name}`,
      seen: [],
      waited: false,
      settle() {
        if (!closed || this.seen.length < count) return;
        for (const [what, store, expected] of this.seen) {
          if (store === expected) continue;
          console.error(
            `FAIL: ${this.name}: ${what} ran in ${JSON.stringify(store)}, expected ${JSON.stringify(expected)}`,
          );
          failed = true;
        }
        resolve();
      },
    };
    client = net.connect(port, "127.0.0.1");
    client.pause();
    client.on("error", err => fail(`${current.name}: the client reported ${err.code}`));
    client.on("data", () => {});
    client.on("close", () => {
      if (!current.waited) fail(`${current.name}: the connection closed before the response's write was seen to wait`);
      closed = true;
      current.settle();
    });
    const last = urls.length - 1;
    client.write(
      urls
        .map((url, i) => `GET ${url} HTTP/1.1\r\nHost: localhost\r\n${i === last ? "Connection: close\r\n" : ""}\r\n`)
        .join(""),
    );
  });
}

// "listen": the server listens itself. "emit": the connection reaches the server through emit("connection"), as a
// proxy or a test harness hands one over.
async function run(entry) {
  const server = http.createServer((request, response) => handlers[request.url](response, request));
  const acceptor = entry === "listen" ? server : net.createServer(socket => server.emit("connection", socket));
  await new Promise(resolve => asyncLocalStorage.run("listen", () => acceptor.listen(0, "127.0.0.1", resolve)));
  for (const scenario of scenarios) {
    if (scenario[3] === undefined || scenario[3] === entry) await request(entry, acceptor.address().port, scenario);
  }
  acceptor.close();
}

run("listen")
  .then(() => run("emit"))
  .then(() => process.exit(failed ? 1 : 0));
