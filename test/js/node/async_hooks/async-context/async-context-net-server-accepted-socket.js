process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

// Node runs the events of a handle in the async context the handle was made in. The listening handle is made in
// listen(), so the server's own events continue that call. A handle the server accepts exists before any script
// runs, so the events of an accepted socket run in no store, whatever store its listeners were added in.
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

// Listens on `listenOn` (a path, or the options of a TCP listen) inside a store and serves one connection per peer, one
// after the other. A peer is a function that makes its connection close: it is given the client socket and the accepted
// socket at the accepted socket's first 'data'. Resolves with the events each accepted socket had, once the server has
// closed. `onAccepted` is given each accepted socket in the server's 'connection' event.
function serve(name, options, listenOn, peers, onAccepted) {
  return new Promise(resolve => {
    const clients = [];
    const seen = [];
    const server = net.createServer(options, socket => {
      expectStore(`${name}: the server's 'connection'`, "listen");
      const index = clients.length - 1;
      const events = (seen[index] = []);
      const who = `${name}: connection ${index + 1}`;
      // The store of the listener does not reach the events either: an EventEmitter does not bind its listeners.
      asyncLocalStorage.run("connection listener", () => {
        socket.on("data", () => {
          expectStore(`${who}: the accepted socket's 'data'`, undefined);
          if (events.push("data") === 1) peers[index](clients[index], socket);
        });
        socket.on("end", () => {
          expectStore(`${who}: the accepted socket's 'end'`, undefined);
          events.push("end");
        });
        socket.on("error", () => {
          expectStore(`${who}: the accepted socket's 'error'`, undefined);
          events.push("error");
        });
        socket.on("close", () => {
          expectStore(`${who}: the accepted socket's 'close'`, undefined);
          if (!events.includes("data")) fail(`${who}: the accepted socket closed before its 'data'`);
          if (clients.length < peers.length) return connect();
          // close() is called in no store and no connection is left, so the server's 'close' has no store either.
          server.on("close", () => expectStore(`${name}: the server's 'close'`, undefined));
          server.close(() => resolve(seen));
        });
      });
      onAccepted?.(socket);
    });
    server.on("error", err => fail(`${name}: the server reported ${err.code}`));

    function connect() {
      const to = typeof listenOn === "string" ? listenOn : { port: server.address().port, host: listenOn.host };
      // In no store, so that nothing but the listen() call could have given the accepted socket one.
      const client = asyncLocalStorage.exit(() => net.connect(to));
      clients.push(client);
      client.on("connect", () => client.write("hello"));
      client.on("error", () => {});
      client.resume();
    }

    asyncLocalStorage.run("listen", () => {
      server.on("listening", () => expectStore(`${name}: the server's 'listening'`, "listen"));
      server.listen(listenOn, () => {
        expectStore(`${name}: the listen() callback`, "listen");
        connect();
      });
    });
  });
}

// The accepted socket answers and ends. The client ends in turn, so both sides close without an error.
const endsCleanly = (client, socket) => socket.end("bye");
// The client resets the connection under the accepted socket, which is reading.
const resets = client => client.resetAndDestroy();

(async () => {
  const loopback = { port: 0, host: "127.0.0.1" };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "async-context-net-"));
  const pipe =
    process.platform === "win32"
      ? `\\\\.\\pipe\\async-context-net-${process.pid}-${path.basename(directory)}`
      : path.join(directory, "server.sock");
  let seen;
  try {
    [seen] = await Promise.all([
      serve("a TCP server", {}, loopback, [endsCleanly, resets]),
      serve("a server on a path", {}, pipe, [endsCleanly]),
      // resume() is called in a store of its own: the 'data' that follows is still the accepted handle's.
      serve("a pauseOnConnect server", { pauseOnConnect: true }, loopback, [endsCleanly], socket =>
        asyncLocalStorage.run("resume", () => socket.resume()),
      ),
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  if (!seen[0].includes("end")) fail(`a TCP server: connection 1 had ${seen[0]}, expected an 'end'`);
  if (!seen[1].includes("error")) fail(`a TCP server: connection 2 had ${seen[1]}, expected an 'error'`);

  process.exit(failed ? 1 : 0);
})();
