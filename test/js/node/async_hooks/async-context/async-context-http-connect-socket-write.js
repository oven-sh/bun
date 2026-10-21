process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");

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

// The two ends of a CONNECT tunnel are the connection itself, with HTTP out of the way on both sides.
// Until the last step, an 'error' or a 'close' of either end fails the fixture.
let closing = false;
function watch(side, socket) {
  socket.on("error", err => closing || fail(`the ${side} end of the tunnel reported ${err.code}`));
  socket.on("close", () => closing || fail(`the ${side} end of the tunnel closed with checks still to run`));
  socket.pause();
  return socket;
}

const server = http.createServer();
let serverEnd;
server.on("connect", (request, socket) => {
  serverEnd = watch("server", socket);
  socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
});

// Writes `big` on `writer` in a context of its own while `reader` does not read, then lets `reader` read.
function writeThatWaits(side, writer, reader) {
  return new Promise(resolve => {
    let pending = 2;
    const done = () => --pending === 0 && resolve();
    asyncLocalStorage.run("write", () =>
      writer.write(big, () => {
        expectStore(`the callback of a write that waited on the ${side} end of a tunnel`, "write");
        done();
      }),
    );
    // Windows takes a write of any size at once, so there is nothing to check there. Anywhere else, a write that did
    // not wait would let the fixture pass without a test.
    if (writer.writableLength === 0) {
      if (process.platform !== "win32") fail(`the write on the ${side} end of the tunnel did not wait for the socket`);
      return resolve();
    }
    writer.once("drain", () => {
      expectStore(`'drain' after a write that waited on the ${side} end of a tunnel`, "write");
      done();
    });
    reader.resume();
  });
}

asyncLocalStorage.run("listen", () =>
  server.listen(0, "127.0.0.1", () => {
    const request = asyncLocalStorage.run("request", () =>
      http.request({ port: server.address().port, host: "127.0.0.1", method: "CONNECT", path: "example.com:443" }),
    );
    request.on("error", err => fail(`the CONNECT request reported ${err.code}`));
    request.on("connect", (response, socket) =>
      asyncLocalStorage.exit(async () => {
        const clientEnd = watch("client", socket);
        await writeThatWaits("server", serverEnd, clientEnd);
        clientEnd.pause();
        await writeThatWaits("client", clientEnd, serverEnd);
        // The client goes away while a write of the server end waits: the write fails where it was issued.
        clientEnd.pause();
        closing = true;
        await new Promise(resolve => {
          asyncLocalStorage.run("write", () =>
            serverEnd.write(big, () => {
              expectStore(
                "the callback of a write on the server end of a tunnel, which the close of the connection fails",
                "write",
              );
              resolve();
            }),
          );
          clientEnd.destroy();
        });
        serverEnd.destroy();
        server.close();
        process.exit(failed ? 1 : 0);
      }),
    );
    request.end();
  }),
);
