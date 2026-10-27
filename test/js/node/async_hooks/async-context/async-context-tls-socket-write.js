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
const server = tls.createServer(
  {
    key: fs.readFileSync(path.join(fixtures, "agent1-key.pem")),
    cert: fs.readFileSync(path.join(fixtures, "agent1-cert.pem")),
  },
  socket => {
    socket.on("error", () => {});
    socket.resume();
  },
);

// Connects in a context of its own and runs `start(socket, done)` in the socket's 'connect' event. The TLS handshake
// has not completed then, so what the socket is given to write has to wait for it. An 'error' of the socket, or its
// 'close' with checks still to run, fails the scenario by name.
function beforeHandshake(name, count, start) {
  return new Promise(resolve => {
    let settled = false;
    const socket = asyncLocalStorage.run("connect", () =>
      tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false }),
    );
    socket.on("error", err => settled || fail(`${name}: the socket reported ${err.code}`));
    socket.on("close", () =>
      setImmediate(() => settled || fail(`${name}: the socket closed with ${count} of its checks still to run`)),
    );
    socket.once("connect", () =>
      asyncLocalStorage.exit(start, socket, () => {
        if (--count > 0) return;
        settled = true;
        socket.destroy();
        resolve();
      }),
    );
  });
}

server.listen(0, "127.0.0.1", async () => {
  await beforeHandshake("write() before the handshake", 1, (socket, done) => {
    asyncLocalStorage.run("write", () =>
      socket.write("x", () => {
        expectStore("the callback of a write before the handshake", "write");
        done();
      }),
    );
    if (socket.writableLength === 0) fail("write() before the handshake: the write did not wait for the handshake");
  });

  await beforeHandshake("end(chunk) before the handshake", 2, (socket, done) => {
    socket.once("finish", () => {
      expectStore("'finish' after an end(chunk) before the handshake", "end");
      done();
    });
    asyncLocalStorage.run("end", () =>
      socket.end("x", () => {
        expectStore("the callback of an end(chunk) before the handshake", "end");
        done();
      }),
    );
    if (socket.writableLength === 0) fail("end(chunk) before the handshake: the write did not wait for the handshake");
  });

  // The empty write completes at once, so the stream ends from inside its completion: end() only marks the end.
  await beforeHandshake("write('') and end() before the handshake", 3, (socket, done) => {
    socket.once("finish", () => {
      expectStore("'finish' after an empty write and end() before the handshake", "write");
      done();
    });
    asyncLocalStorage.run("write", () =>
      socket.write("", () => {
        expectStore("the callback of an empty write before the handshake", "write");
        done();
      }),
    );
    asyncLocalStorage.run("end", () =>
      socket.end(() => {
        expectStore("the callback of an end() behind an empty write before the handshake", "write");
        done();
      }),
    );
  });

  // The peer does not speak TLS, so the handshake fails under the write: the write fails where it was issued.
  await new Promise(resolve => {
    const plain = net.createServer(socket => {
      socket.on("error", () => {});
      socket.on("data", () => socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"));
    });
    plain.listen(0, "127.0.0.1", () => {
      let pending = 2;
      const done = () => {
        if (--pending > 0) return;
        plain.close();
        resolve();
      };
      const socket = asyncLocalStorage.run("connect", () =>
        tls.connect({ port: plain.address().port, host: "127.0.0.1", rejectUnauthorized: false }),
      );
      socket.on("error", () => {});
      socket.once("close", () => {
        expectStore("'close' after a handshake that fails under a write", "connect");
        done();
      });
      socket.once("connect", () =>
        asyncLocalStorage.exit(() =>
          asyncLocalStorage.run("write", () =>
            socket.write("x", err => {
              if (!err) fail("a handshake that fails under a write: the write did not fail");
              expectStore("the callback of a write before a handshake that fails", "write");
              done();
            }),
          ),
        ),
      );
    });
  });

  server.close();
  process.exit(failed ? 1 : 0);
});
