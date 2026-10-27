process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");
const net = require("net");

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

// More than the kernel takes in one call while the peer does not read: the write has to wait for the socket.
const big = Buffer.alloc(8 * 1024 * 1024);

const server = http.createServer();
let client;

// The socket an 'upgrade' listener gets is the connection itself, with the HTTP server out of the way.
server.on("upgrade", (req, socket) => {
  let pending = 2;
  function finish() {
    pending = 0;
    client.destroy();
    socket.destroy();
    server.close();
    process.exit(failed ? 1 : 0);
  }
  function done() {
    if (--pending === 0) finish();
  }
  socket.on("error", err => pending === 0 || fail(`the upgraded socket reported ${err.code}`));
  socket.on("close", () =>
    setImmediate(() => pending === 0 || fail(`the upgraded socket closed with ${pending} of its checks still to run`)),
  );
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n");

  asyncLocalStorage.run("write", () =>
    socket.write(big, () => {
      expectStore("the callback of a write that waited on an upgraded socket", "write");
      done();
    }),
  );
  // Windows takes a write of any size at once, so there is nothing to check there. Anywhere else, a write that did
  // not wait would let the fixture pass without a test.
  if (socket.writableLength === 0) {
    if (process.platform !== "win32") fail("the write on the upgraded socket did not wait for the socket");
    return finish();
  }
  socket.once("drain", () => {
    expectStore("'drain' after a write that waited on an upgraded socket", "write");
    done();
  });
  client.resume();
});

server.listen(0, "127.0.0.1", () => {
  client = net.connect(server.address().port, "127.0.0.1");
  client.pause();
  client.on("error", () => {});
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n");
});
