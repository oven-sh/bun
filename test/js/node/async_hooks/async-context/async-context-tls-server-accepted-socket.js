process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");
const tls = require("tls");

// A tls.Server makes the TLS socket of a connection in its 'connection' event, which continues the store of listen().
// So, unlike the events of a socket that a net.Server accepted, the TLS socket's events run in that store.
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

const fixtures = path.join(__dirname, "..", "..", "tls", "fixtures");
const seen = [];
const server = tls.createServer({
  key: fs.readFileSync(path.join(fixtures, "agent1-key.pem")),
  cert: fs.readFileSync(path.join(fixtures, "agent1-cert.pem")),
  SNICallback(servername, callback) {
    expectStore("SNICallback", "listen");
    seen.push("SNICallback");
    callback(null);
  },
  ALPNCallback({ protocols }) {
    expectStore("ALPNCallback", "listen");
    seen.push("ALPNCallback");
    return protocols[0];
  },
});
server.on("error", err => fail(`the server reported ${err.code}`));
server.on("tlsClientError", err => fail(`the handshake failed with ${err.code}`));

server.on("connection", () => expectStore("the server's 'connection'", "listen"));
server.on("secureConnection", socket => {
  expectStore("the server's 'secureConnection'", "listen");
  // The store of the listener does not reach the events: an EventEmitter does not bind its listeners.
  asyncLocalStorage.run("connection listener", () => {
    socket.on("data", () => {
      expectStore("the accepted socket's 'data'", "listen");
      seen.push("data");
      socket.end("bye");
    });
    socket.on("end", () => {
      expectStore("the accepted socket's 'end'", "listen");
      seen.push("end");
    });
    // Not checked: 'close' is the event of the TCP socket under the TLS socket, so Node runs it in no store. Bun runs
    // it in the store of listen().
    socket.on("close", () => {
      for (const expected of ["SNICallback", "ALPNCallback", "data", "end"]) {
        if (!seen.includes(expected)) fail(`the connection closed with ${seen}, expected ${expected}`);
      }
      server.close(() => process.exit(failed ? 1 : 0));
    });
  });
});

asyncLocalStorage.run("listen", () => {
  server.listen(0, "127.0.0.1", () => {
    // In no store, so that nothing but the listen() call could have given the accepted socket one.
    const client = asyncLocalStorage.exit(() =>
      tls.connect({
        port: server.address().port,
        host: "127.0.0.1",
        servername: "agent1",
        ALPNProtocols: ["test"],
        rejectUnauthorized: false,
      }),
    );
    client.on("secureConnect", () => client.write("hello"));
    client.on("error", () => {});
    client.resume();
  });
});
