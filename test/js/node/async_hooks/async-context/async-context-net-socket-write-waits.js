process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const net = require("net");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

// More than the kernel takes in one call while the peer does not read: the write has to wait for the socket.
const big = Buffer.alloc(8 * 1024 * 1024);

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

// The write `socket` was just given has to wait for the socket, or the scenario would pass without a test.
function mustWait(socket, scenario) {
  if (socket.writableLength === 0) fail(`${scenario}: the write did not wait for the socket`);
}

// A connected pair. listen() and connect() each run in a context of their own: a callback that runs where the socket
// was opened, and not where the write was issued, sees "listen" or "connect". Neither side reads until it is resumed.
function pair(connectOptions) {
  return new Promise((resolve, reject) => {
    const accepted = [];
    let client;
    let ready = 0;
    const connected = () => ++ready === 2 && resolve({ server, client, accepted });
    const server = net.createServer(socket => {
      socket.pause();
      accepted.push(socket);
      connected();
    });
    server.on("error", reject);
    asyncLocalStorage.run("listen", () =>
      server.listen(0, "127.0.0.1", () => {
        client = asyncLocalStorage.run("connect", () =>
          net.connect({ port: server.address().port, host: "127.0.0.1", ...connectOptions }),
        );
        client.pause();
        client.once("connect", connected);
      }),
    );
  });
}

// Runs `start(sockets, done)` on a new pair, until `done` was called `count` times.
// `sockets.watch(socket)` is for the socket whose write waits: its 'error', or its 'close' with checks still to run,
// fails the scenario by name. The peer only goes away, so its errors are nothing to report.
async function scenario(name, count, start, connectOptions) {
  const sockets = await pair(connectOptions);
  let settled = false;
  sockets.watch = socket => {
    socket.on("error", err => settled || fail(`${name}: the socket reported ${err.code}`));
    socket.on("close", () =>
      setImmediate(() => settled || fail(`${name}: the socket closed with ${count} of its checks still to run`)),
    );
    return socket;
  };
  for (const peer of sockets.accepted) peer.on("error", () => {});
  await new Promise(resolve => start(sockets, () => --count === 0 && resolve()));
  settled = true;
  sockets.client.destroy();
  for (const socket of sockets.accepted) socket.destroy();
  sockets.server.close();
}

async function writesThatWait() {
  // A socket that is still connecting has nothing to write to: the write is issued from 'connect'.
  await scenario("write() while connecting", 1, ({ server, watch }, done) => {
    const connecting = watch(asyncLocalStorage.run("connect", () => net.connect(server.address().port, "127.0.0.1")));
    asyncLocalStorage.run("write", () =>
      connecting.write("early", () => {
        expectStore("the callback of a write issued while connecting", "connect");
        done();
        connecting.destroy();
      }),
    );
  });

  // Windows takes a write of any size at once: no write waits for its socket there, and the rest has nothing to check.
  if (process.platform === "win32") return;

  await scenario("write(big)", 2, ({ client, accepted: [accepted], watch }, done) => {
    watch(client);
    client.once("drain", () => {
      expectStore("'drain' after a write that waited", "write");
      done();
    });
    asyncLocalStorage.run("write", () =>
      client.write(big, () => {
        expectStore("the callback of a write that waited", "write");
        done();
      }),
    );
    mustWait(client, "write(big)");
    accepted.resume();
  });

  await scenario("end(big)", 2, ({ client, accepted: [accepted], watch }, done) => {
    watch(client);
    client.once("finish", () => {
      expectStore("'finish' after an end(chunk) that waited", "end");
      done();
    });
    asyncLocalStorage.run("end", () =>
      client.end(big, () => {
        expectStore("the callback of an end(chunk) that waited", "end");
        done();
      }),
    );
    mustWait(client, "end(big)");
    accepted.resume();
  });

  // The stream hands a queued write to the socket when the write before it completes, so it inherits that context.
  await scenario("a write behind write(big)", 2, ({ client, accepted: [accepted], watch }, done) => {
    watch(client);
    asyncLocalStorage.run("first write", () =>
      client.write(big, () => {
        expectStore("the callback of the first of two writes", "first write");
        done();
      }),
    );
    mustWait(client, "a write behind write(big)");
    asyncLocalStorage.run("second write", () =>
      client.write("second", () => {
        expectStore("the callback of a write behind one that waited", "first write");
        done();
      }),
    );
    accepted.resume();
  });

  // uncork() is what hands a corked write to the socket.
  await scenario("a corked write(big)", 1, ({ client, accepted: [accepted], watch }, done) => {
    watch(client);
    client.cork();
    asyncLocalStorage.run("write", () =>
      client.write(big, () => {
        expectStore("the callback of a corked write that waited", "uncork");
        done();
      }),
    );
    asyncLocalStorage.run("uncork", () => client.uncork());
    mustWait(client, "a corked write(big)");
    accepted.resume();
  });

  await scenario("write(big) of an accepted socket", 1, ({ client, accepted: [accepted], watch }, done) => {
    watch(accepted);
    client.on("error", () => {});
    asyncLocalStorage.run("write", () =>
      accepted.write(big, () => {
        expectStore("the callback of an accepted socket's write that waited", "write");
        done();
      }),
    );
    mustWait(accepted, "write(big) of an accepted socket");
    client.resume();
  });

  await scenario("write(big) outside any context", 1, ({ client, accepted: [accepted], watch }, done) => {
    watch(client);
    client.write(big, () => {
      expectStore("the callback of a write issued outside any context", undefined);
      done();
    });
    mustWait(client, "write(big) outside any context");
    accepted.resume();
  });

  // The peer never reads: destroy() is what completes the write.
  await scenario("destroy() under write(big)", 1, ({ client }, done) => {
    client.on("error", () => {});
    asyncLocalStorage.run("write", () =>
      client.write(big, () => {
        expectStore("the callback of a waiting write that destroy() completed", "write");
        done();
      }),
    );
    mustWait(client, "destroy() under write(big)");
    client.destroy();
  });

  // 'close' is the handle's event: it runs where the socket was opened, also when a write that waited is what closes
  // the socket from its own context.
  await scenario("destroySoon() behind write(big)", 2, ({ client, accepted: [accepted], watch }, done) => {
    watch(client);
    client.once("close", () => {
      expectStore("'close' after destroySoon() behind a write that waited", "connect");
      done();
    });
    asyncLocalStorage.run("write", () =>
      client.write(big, () => {
        expectStore("the callback of a write that waited, with destroySoon() behind it", "write");
        done();
      }),
    );
    mustWait(client, "destroySoon() behind write(big)");
    client.destroySoon();
    accepted.resume();
  });

  await scenario(
    "end(big) after the peer's FIN",
    3,
    ({ client, accepted: [accepted], watch }, done) => {
      watch(client);
      client.once("finish", () => {
        expectStore("'finish' after an end(chunk) that waited, after the peer's FIN", "end");
        done();
      });
      client.once("close", () => {
        expectStore("'close' of a socket that an end(chunk) that waited closes", "connect");
        done();
      });
      client.once("end", () => {
        asyncLocalStorage.run("end", () =>
          client.end(big, () => {
            expectStore("the callback of an end(chunk) that waited, after the peer's FIN", "end");
            done();
          }),
        );
        mustWait(client, "end(big) after the peer's FIN");
        accepted.resume();
      });
      client.resume();
      accepted.end();
    },
    { allowHalfOpen: true },
  );

  // Nothing listens for the reset, so it is an uncaught exception. The callbacks of the writes it fails run where the
  // writes were issued, and 'close' where the socket was opened.
  await scenario("the peer's reset under write(big)", 3, ({ client, accepted: [accepted] }, done) => {
    const onReset = () => {};
    process.once("uncaughtException", onReset);
    client.once("close", () => {
      process.removeListener("uncaughtException", onReset);
      expectStore("'close' after the peer's reset under a write that waited", "connect");
      done();
    });
    asyncLocalStorage.run("write", () =>
      client.write(big, err => {
        if (!err) fail("the peer's reset under write(big): the write did not fail");
        expectStore("the callback of a write that waited, which the peer's reset fails", "write");
        done();
      }),
    );
    mustWait(client, "the peer's reset under write(big)");
    asyncLocalStorage.run("queued write", () =>
      client.write("queued", () => {
        expectStore("the callback of a write behind one that the peer's reset fails", "write");
        done();
      }),
    );
    client.resume();
    accepted.resetAndDestroy();
  });
}

writesThatWait().then(() => process.exit(failed ? 1 : 0));
