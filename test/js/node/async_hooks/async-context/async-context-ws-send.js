process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const net = require("net");
const { createHash } = require("crypto");
// The npm package under Node, the built-in under Bun.
const { WebSocket } = require("ws");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

function fail(message, ...rest) {
  console.error(`FAIL: ${message}`, ...rest);
  failed = true;
}

// More than the kernel buffers of a loopback connection hold, so the send has to wait until the peer reads.
const big = Buffer.alloc(8 * 1024 * 1024);

// Minimal RFC 6455 server: completes the upgrade and then doesn't read until it is told to.
let accepted;
const peer = new Promise(resolve => (accepted = resolve));
const server = net.createServer(socket => {
  let request = Buffer.alloc(0);
  socket.on("data", function onHandshakeData(chunk) {
    request = Buffer.concat([request, chunk]);
    if (!request.includes("\r\n\r\n")) return;
    socket.off("data", onHandshakeData);

    const key = /Sec-WebSocket-Key: (.*)\r\n/i.exec(request.toString())[1].trim();
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on("data", () => {});
    socket.pause();
    accepted(socket);
  });
  socket.on("error", () => {});
});

// Resolves with the store that the callback of `call` observes. The callback gets `null` and nothing else.
function storeInCallback(what, call) {
  return new Promise(resolve =>
    call((...args) => {
      if (args.length !== 1 || args[0] !== null) fail(`the callback of ${what} was called with`, args);
      resolve(asyncLocalStorage.getStore());
    }),
  );
}

async function expectStore(what, expected, pending) {
  const store = await pending;
  if (store !== expected) fail(`the callback of ${what} ran in`, store, "instead of", expected);
}

// The socket's events observe the async context of the `new WebSocket()` call. A send(), ping() or pong() callback
// observes the context of its own call instead, also when that call was made outside every run().
server.listen(0, "127.0.0.1", async () => {
  const ws = await new Promise((resolve, reject) => {
    asyncLocalStorage.run("constructor", () => {
      // With permessage-deflate, npm ws runs every callback in the context of the first send that was compressed.
      const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`, { perMessageDeflate: false });
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  });
  const socket = await peer;

  // This function was called outside every run(), and so is each call below that isn't wrapped in one.
  const waited = storeInCallback("send()", callback => ws.send(big, callback));
  // On loopback, Winsock accepts the whole write.
  if (process.platform !== "win32" && ws.bufferedAmount === 0) fail("the send did not have to wait");
  setImmediate(() => socket.resume());
  await expectStore("a send() that waited", undefined, waited);

  await expectStore(
    "a send() in a store",
    "sender",
    asyncLocalStorage.run("sender", () => storeInCallback("send()", callback => ws.send("x", callback))),
  );
  await expectStore(
    "ping()",
    undefined,
    storeInCallback("ping()", callback => ws.ping("x", undefined, callback)),
  );
  await expectStore(
    "pong()",
    undefined,
    storeInCallback("pong()", callback => ws.pong("x", undefined, callback)),
  );

  ws.terminate();
  server.close(() => process.exit(failed ? 1 : 0));
});
