// A socket writes more than the kernel takes at once, and then unref(). The bytes that are left
// to send keep the process alive until they are sent, as a write request does in libuv, whatever
// unref() said. Then the write callback runs, and it ends the connection.
//
// The reader is in this process and unref'd. The process has no timer and calls no
// process.exit(): it prints what the writer saw and what the reader got when it exits.
//
//   argv[2]: "tcp", "tls" or "tls in tls", the kind of socket that writes.
//   TLS_CERT and TLS_KEY: the certificate of the TLS servers.
import net from "node:net";
import tls from "node:tls";

const { TLS_CERT: cert, TLS_KEY: key } = process.env;
const kind = process.argv[2];
const insecure = { host: "127.0.0.1", rejectUnauthorized: false };
const size = 4 * 1024 * 1024;
const result = { events: [], received: 0 };
process.on("exit", () => console.log(JSON.stringify(result)));

function writer(socket) {
  socket.on("error", err => result.events.push(`error ${err.code}`));
  socket.on("close", () => result.events.push("close"));
  socket.resume();
  socket.write(Buffer.alloc(size, "x"), () => {
    result.events.push("write callback");
    // From here on the process waits for the close.
    socket.ref();
    socket.end();
  });
  socket.unref();
}

function reader(socket) {
  socket.on("error", () => {});
  socket.on("data", chunk => (result.received += chunk.length));
  return socket;
}

if (kind === "tcp") {
  const server = net.createServer(socket => {
    server.close();
    writer(socket);
  });
  server.listen(0, "127.0.0.1", () => reader(net.connect(server.address().port, "127.0.0.1")).unref());
} else {
  const server = tls.createServer({ cert, key }, socket => {
    server.close();
    if (kind === "tls") return writer(socket);
    socket.on("error", () => {});
    const inner = new tls.TLSSocket(socket, { isServer: true, cert, key });
    inner.once("secure", () => writer(inner));
  });
  server.listen(0, "127.0.0.1", () => {
    const client = tls.connect({ port: server.address().port, ...insecure });
    client.unref();
    if (kind === "tls") return reader(client);
    client.on("error", () => {});
    client.once("secureConnect", () => reader(tls.connect({ socket: client, ...insecure })));
  });
}
