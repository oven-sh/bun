const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createServer, Socket } = require("node:net");

async function main() {
  const autoSelectFamily = process.argv[2] === "true";
  const alreadyAborted = process.argv[3] === "true";
  const controller = new AbortController();
  const reason = new Error("lookup aborted");
  if (alreadyAborted) controller.abort(reason);

  const accepted = [];
  const server = createServer(connection => {
    accepted.push(connection);
    connection.destroy();
  });
  const events = [];
  const errors = [];
  let socket;
  let closed;

  try {
    await once(server.listen(0, "127.0.0.1"), "listening");
    socket = new Socket({ signal: controller.signal });
    closed = new Promise(resolve =>
      socket.once("close", () => {
        events.push("close");
        resolve();
      }),
    );
    socket.on("error", error => {
      events.push("error");
      errors.push(error);
    });
    socket.on("connectionAttempt", () => events.push("connectionAttempt"));
    socket.on("connect", () => events.push("connect"));
    const { promise: lookupStarted, resolve: onLookup } = Promise.withResolvers();
    let completeLookup;
    socket.connect({
      host: "held-lookup.test",
      port: server.address().port,
      autoSelectFamily,
      lookup(_hostname, options, callback) {
        completeLookup = () =>
          options.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4);
        onLookup();
      },
    });
    if (!alreadyAborted) {
      await lookupStarted;
      controller.abort(reason);
    }
    await closed;

    // A late successful lookup may emit "lookup", but must not resurrect a closed socket.
    completeLookup?.();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ["error", "close"]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].name, "AbortError");
    assert.equal(errors[0].code, "ABORT_ERR");
    assert.equal(errors[0].cause, reason);
    assert.equal(socket.destroyed, true);
    assert.equal(accepted.length, 0);
  } finally {
    if (socket) {
      socket.destroy();
      await closed;
    }
    for (const connection of accepted) connection.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  console.log("abort assertions passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
