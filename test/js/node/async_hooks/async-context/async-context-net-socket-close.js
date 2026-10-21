process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const net = require("net");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

function fail(message) {
  console.error(`FAIL: ${message}`);
  failed = true;
}

function expectStore(what, expected) {
  const store = asyncLocalStorage.getStore();
  if (store !== expected) fail(`${what} ran in ${JSON.stringify(store)}, expected ${JSON.stringify(expected)}`);
}

function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Node emits 'close' from the close callback of the socket's handle. That callback runs in the async context the handle
// was made in, which is the connect() call. The context of whoever destroys the socket does not change it.
function closed(socket, what, expected) {
  return new Promise(resolve =>
    socket.once("close", () => {
      expectStore(`'close' after ${what}`, expected);
      resolve();
    }),
  );
}

// `act(socket)` runs in the store `store` once `socket` is connected.
function whenConnected(socket, store, act) {
  socket.once("connect", () => asyncLocalStorage.run(store, act, socket));
  return socket;
}

async function main() {
  // Reads what it is sent and never ends the connection.
  const sink = await listen(
    net.createServer(socket => {
      socket.on("error", () => {});
      socket.resume();
    }),
  );
  // Ends every connection at once.
  const finisher = await listen(
    net.createServer(socket => {
      socket.on("error", () => {});
      socket.end();
    }),
  );
  const port = sink.address().port;
  const connect = options =>
    asyncLocalStorage.run("connect", () => net.connect({ port, host: "127.0.0.1", ...options }));

  await Promise.all([
    closed(
      whenConnected(connect(), "destroy", socket => socket.destroy()),
      "destroy()",
      "connect",
    ),

    closed(
      whenConnected(
        connect().on("error", () => {}),
        "destroy",
        socket => socket.destroy(new Error("destroyed")),
      ),
      "destroy(error)",
      "connect",
    ),

    closed(
      whenConnected(connect(), "reset", socket => socket.resetAndDestroy()),
      "resetAndDestroy()",
      "connect",
    ),

    closed(
      whenConnected(connect(), "destroySoon", socket => socket.destroySoon()),
      "destroySoon()",
      "connect",
    ),

    // The peer's FIN came first, so this end() is what closes the socket.
    (() => {
      const socket = connect({ port: finisher.address().port, allowHalfOpen: true });
      socket.once("end", () => asyncLocalStorage.run("end", () => socket.end()));
      socket.resume();
      return closed(socket, "end() behind the peer's FIN", "connect");
    })(),

    // Still connecting. The write has nowhere to go, and its callback is called from a 'close' listener.
    (async () => {
      const socket = connect();
      let code;
      asyncLocalStorage.run("write", () =>
        socket.write("early", err => {
          code = err?.code;
          expectStore("the callback of a write that destroy() cut off before the connection", "connect");
        }),
      );
      asyncLocalStorage.run("destroy", () => socket.destroy());
      await closed(socket, "destroy() while connecting", "connect");
      if (code !== "ERR_SOCKET_CLOSED_BEFORE_CONNECTION") fail(`the write cut off before the connection got ${code}`);
    })(),

    // A handle made in no context keeps none, whatever store the destroyer has.
    closed(
      whenConnected(net.connect(port, "127.0.0.1"), "destroy", socket => socket.destroy()),
      "destroy() of a socket that connect() made outside any store",
      undefined,
    ),

    // The handle is made by connect(), not by the constructor, and a later connect() makes another.
    (async () => {
      const socket = asyncLocalStorage.run("construct", () => new net.Socket());
      asyncLocalStorage.run("connect", () => socket.connect(port, "127.0.0.1"));
      whenConnected(socket, "destroy", socket => socket.destroy());
      await closed(socket, "destroy() of a socket constructed in another context", "connect");

      asyncLocalStorage.run("second connect", () => socket.connect(port, "127.0.0.1"));
      whenConnected(socket, "destroy", socket => socket.destroy());
      await closed(socket, "destroy() of a socket that was connected again", "second connect");
    })(),

    // The address comes back in another context. The handle was made before the lookup, in connect().
    closed(
      whenConnected(
        connect({
          host: "close.test",
          autoSelectFamily: false,
          lookup: (hostname, options, callback) =>
            process.nextTick(() => asyncLocalStorage.run("lookup", callback, null, "127.0.0.1", 4)),
        }),
        "destroy",
        socket => socket.destroy(),
      ),
      "destroy() of a socket whose lookup answered in another context",
      "connect",
    ),

    (async () => {
      let closes = 0;
      const socket = whenConnected(connect(), "destroy", socket => {
        socket.destroy();
        asyncLocalStorage.run("destroy again", () => socket.destroy());
      });
      socket.on("close", () => closes++);
      await closed(socket, "two destroy() calls", "connect");
      // A second 'close' would be an immediate or a tick behind the first.
      await new Promise(resolve => setImmediate(resolve));
      if (closes !== 1) fail(`two destroy() calls emitted 'close' ${closes} times`);
    })(),

    // Script that wraps the handle's close() still gets 'close', and in the same context.
    closed(
      whenConnected(connect(), "destroy", socket => {
        const handle = socket._handle;
        const close = handle.close;
        handle.close = function (callback) {
          return close.call(this, callback);
        };
        socket.destroy();
      }),
      "destroy() of a socket whose handle has a wrapped close()",
      "connect",
    ),

    // Nobody destroys this one: the peer ends it.
    closed(connect({ port: finisher.address().port }).resume(), "the peer ended the connection", "connect"),
  ]);

  sink.close();
  finisher.close();
  process.exit(failed ? 1 : 0);
}

main();
