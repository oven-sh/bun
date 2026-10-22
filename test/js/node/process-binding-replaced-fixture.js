// Run by process-binding.test.ts. It prints the same under Node.js, where the builtins read a native binding
// through the private internalBinding().
//
// Replaces process.binding, loads built-in modules that read a binding when they load, and takes code paths that
// read one later.
let reads = 0;
// For a reader this is `process.binding = undefined`. It also counts the readers.
Object.defineProperty(process, "binding", {
  get() {
    reads++;
    return undefined;
  },
});

const { once } = require("node:events");

(async () => {
  for (const name of ["http", "https", "zlib", "cluster", "ws"]) require(name);
  const net = require("node:net");
  const result = {};

  const server = net.createServer(socket => socket.on("error", () => {}));
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address();

  // Nothing listens on ::1. node:net compares the status of that attempt with UV_ECANCELED before it tries 127.0.0.1.
  const lookup = (hostname, options, callback) =>
    callback(null, [
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ]);
  const socket = net.connect({ host: "localhost", port, lookup, autoSelectFamily: true });
  await once(socket, "connect");
  result.connectedTo = socket.remoteAddress;
  socket.destroy();

  // Nothing listens on the port after the server closed. The ws client takes the errno from the "uv" binding.
  await new Promise(resolve => server.close(resolve));
  const [refused] = await once(new (require("ws"))(`ws://127.0.0.1:${port}`), "error");
  result.ws = [refused.code, require("node:util").getSystemErrorName(refused.errno)];

  // For a connection that node:http did not accept, the method name comes from the "http_parser" binding.
  const { Duplex } = require("node:stream");
  const connection = new Duplex({ read() {}, write: (chunk, encoding, callback) => callback() });
  const method = new Promise(resolve => {
    require("node:http")
      .createServer(req => resolve(req.method))
      .emit("connection", connection);
  });
  connection.push("PROPFIND / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  result.method = await method;
  connection.destroy();

  console.log(JSON.stringify({ reads, ...result }));
})();
