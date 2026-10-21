process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
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

// Node makes the handle of an accepted socket from the event loop, in no async context. Its close callback, which emits
// 'close', runs there too: not in the store of listen(), and not in the store of whoever destroys the socket.

// Accepts one connection from `connect(port)` and gives it to `accepted(socket, client)`. Resolves at its 'close'.
function scenario(what, connect, accepted) {
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      expectStore(`'connection' of ${what}`, "listen");
      socket.on("error", () => {});
      socket.once("close", () => {
        expectStore(`'close' of ${what}`, undefined);
        server.close();
        resolve();
      });
      accepted(socket, client);
    });
    let client;
    asyncLocalStorage.run("listen", () =>
      server.listen(0, "127.0.0.1", () => {
        client = asyncLocalStorage.run("client", () => connect(server.address().port));
        client.on("error", () => {});
      }),
    );
  });
}

async function main() {
  const connect = port => net.connect(port, "127.0.0.1");

  await Promise.all([
    scenario("an accepted socket that its server destroys", connect, socket =>
      asyncLocalStorage.run("destroy", () => socket.destroy()),
    ),

    scenario("an accepted socket that its server resets", connect, socket =>
      asyncLocalStorage.run("reset", () => socket.resetAndDestroy()),
    ),

    scenario(
      "an accepted socket whose peer ends it",
      port =>
        net.connect(port, "127.0.0.1", function () {
          this.end();
        }),
      socket => socket.resume(),
    ),

    // The peer's FIN closes the connection that the server ended: the handle is gone before the socket is destroyed.
    scenario("an accepted socket that its server ends first", connect, socket => {
      socket.resume();
      asyncLocalStorage.run("end", () => socket.end());
    }),

    scenario(
      "an accepted socket whose peer resets it",
      port =>
        net.connect(port, "127.0.0.1", function () {
          this.resetAndDestroy();
        }),
      socket => socket.resume(),
    ),
  ]);

  process.exit(failed ? 1 : 0);
}

main();
