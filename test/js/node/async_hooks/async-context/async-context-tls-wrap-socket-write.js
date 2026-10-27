process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const net = require("net");
const path = require("path");
const tls = require("tls");

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
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));

// More than the kernel takes in one call while the peer does not read: the write has to wait for the socket.
const big = Buffer.alloc(8 * 1024 * 1024);

// Whether the write `socket` was just given waits for the socket. Windows takes a write of any size at once, so there
// is nothing to check there. Anywhere else, a write that did not wait would let the scenario pass without a test.
function waits(socket, scenario) {
  if (socket.writableLength > 0) return true;
  if (process.platform !== "win32") fail(`${scenario}: the write did not wait for the socket`);
  return false;
}

// STARTTLS, as a mail or database server speaks it: the connection starts in the clear, each side says 'S', and then
// each side wraps its connected socket. `onServerWrap` runs in the tick of the server's wrap.
let onServerWrap;
const server = net.createServer(raw => {
  raw.on("error", () => {});
  raw.once("data", () => {
    raw.write("S");
    const secured = asyncLocalStorage.run("server wrap", () => new tls.TLSSocket(raw, { isServer: true, key, cert }));
    secured.pause();
    onServerWrap(secured);
  });
});

// Runs `start(client, accepted, done, skip)` in the tick of the client's wrap, and `serverStart(accepted, done)` in the
// tick of the server's, until `done` was called `count` times or `skip` once. `accepted()` is the server's wrap.
// An 'error' of either wrap, or its 'close' with checks still to run, fails the scenario by name.
function starttls(name, count, start, serverStart = () => {}) {
  return new Promise(resolve => {
    let secured, accepted;
    let settled = false;
    const settle = () => {
      settled = true;
      secured.destroy();
      accepted.destroy();
      resolve();
    };
    const done = () => --count === 0 && settle();
    const watch = socket => {
      socket.on("error", err => settled || fail(`${name}: a socket reported ${err.code}`));
      socket.on("close", () =>
        setImmediate(() => settled || fail(`${name}: a socket closed with ${count} of the checks still to run`)),
      );
      return socket;
    };
    onServerWrap = socket => {
      accepted = watch(socket);
      asyncLocalStorage.exit(serverStart, socket, done);
    };
    const raw = asyncLocalStorage.run("connect", () => net.connect(server.address().port, "127.0.0.1"));
    raw.on("error", () => {});
    raw.once("connect", () => raw.write("S"));
    raw.once("data", () => {
      secured = watch(
        asyncLocalStorage.run("client wrap", () => tls.connect({ socket: raw, rejectUnauthorized: false })),
      );
      asyncLocalStorage.exit(start, secured, () => accepted, done, settle);
    });
  });
}

server.listen(0, "127.0.0.1", async () => {
  await starttls("write() before the handshake of a client wrap", 1, (socket, accepted, done) => {
    asyncLocalStorage.run("write", () =>
      socket.write("x", () => {
        expectStore("the callback of a write before the handshake of a client wrap", "write");
        done();
      }),
    );
  });

  await starttls("end(chunk) before the handshake of a client wrap", 2, (socket, accepted, done) => {
    socket.once("finish", () => {
      expectStore("'finish' after an end(chunk) before the handshake of a client wrap", "end");
      done();
    });
    asyncLocalStorage.run("end", () =>
      socket.end("x", () => {
        expectStore("the callback of an end(chunk) before the handshake of a client wrap", "end");
        done();
      }),
    );
  });

  await starttls("write(big) of a client wrap", 2, (socket, accepted, done, skip) => {
    socket.once("secureConnect", () =>
      asyncLocalStorage.exit(() => {
        asyncLocalStorage.run("write", () =>
          socket.write(big, () => {
            expectStore("the callback of a write that waited on a client wrap", "write");
            done();
          }),
        );
        if (!waits(socket, "write(big) of a client wrap")) return skip();
        socket.once("drain", () => {
          expectStore("'drain' after a write that waited on a client wrap", "write");
          done();
        });
        accepted().resume();
      }),
    );
  });

  // Node's handle takes a write in the tick of the wrap. The next one is queued behind it, so it inherits that context.
  await starttls(
    "two writes in the tick of a server wrap",
    2,
    socket => socket.resume(),
    (accepted, done) => {
      asyncLocalStorage.run("first write", () =>
        accepted.write("banner", () => {
          expectStore("the callback of a write in the tick of a server wrap", "first write");
          done();
        }),
      );
      asyncLocalStorage.run("second write", () =>
        accepted.write("more", () => {
          expectStore("the callback of a write behind one in the tick of a server wrap", "first write");
          done();
        }),
      );
    },
  );

  await starttls("write(big) of a server wrap", 2, (socket, accepted, done, skip) => {
    socket.pause();
    socket.once("secureConnect", () =>
      asyncLocalStorage.exit(() => {
        const writer = accepted();
        asyncLocalStorage.run("write", () =>
          writer.write(big, () => {
            expectStore("the callback of a write that waited on a server wrap", "write");
            done();
          }),
        );
        if (!waits(writer, "write(big) of a server wrap")) return skip();
        writer.once("drain", () => {
          expectStore("'drain' after a write that waited on a server wrap", "write");
          done();
        });
        socket.resume();
      }),
    );
  });

  // The wrap is destroyed in its own tick: the write it was given never leaves, and fails where it was issued.
  await new Promise(resolve => {
    let peer;
    const closing = net.createServer(raw => {
      raw.on("error", () => {});
      const secured = asyncLocalStorage.run("server wrap", () => new tls.TLSSocket(raw, { isServer: true, key, cert }));
      secured.on("error", () => {});
      asyncLocalStorage.run("write", () =>
        secured.write("banner", () => {
          expectStore("the callback of a write in the tick of a server wrap that is destroyed in that tick", "write");
          peer.destroy();
          closing.close();
          resolve();
        }),
      );
      asyncLocalStorage.run("destroy", () => secured.destroy());
    });
    closing.listen(0, "127.0.0.1", () => {
      peer = net.connect(closing.address().port, "127.0.0.1");
      peer.on("error", () => {});
    });
  });

  server.close();
  process.exit(failed ? 1 : 0);
});
