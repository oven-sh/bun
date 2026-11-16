process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const net = require("net");
const { createHash } = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;
const seen = new Set();

function check(name) {
  const store = asyncLocalStorage.getStore();
  seen.add(name);
  if (store?.test !== "WebSocket") {
    console.error(`FAIL: WebSocket ${name} handler lost context, got`, store);
    failed = true;
  }
}

// Minimal RFC 6455 server: completes the upgrade, sends one text frame,
// then starts the closing handshake.
const server = net.createServer(socket => {
  // The upgrade request may be split across TCP chunks: buffer until the
  // header block is complete before parsing it.
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
    socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69])); // text frame "hi"
    socket.write(Buffer.from([0x88, 0x02, 0x03, 0xe8])); // close frame, code 1000
    // The next bytes are the client's close frame reply: finish the TCP close.
    socket.once("data", () => socket.end());
  });
  socket.on("error", () => {});
});

server.listen(0, () => {
  const port = server.address().port;

  // Event handlers observe the async context that was active when the
  // WebSocket was constructed, whether assigned as onX or via addEventListener.
  asyncLocalStorage.run({ test: "WebSocket" }, () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onopen = () => check("open");
    ws.onmessage = () => check("message");
    ws.addEventListener("close", () => check("close (addEventListener)"));
    ws.onclose = () => {
      check("close");
      server.close(() => {
        for (const name of ["open", "message", "close", "close (addEventListener)"]) {
          if (!seen.has(name)) {
            console.error(`FAIL: WebSocket ${name} handler never ran`);
            failed = true;
          }
        }
        process.exit(failed ? 1 : 0);
      });
    };
  });
});
