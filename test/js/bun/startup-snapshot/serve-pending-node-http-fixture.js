// node:http listens through Bun.serve, so a server created before the snapshot defers its bind too.
// That includes the custom options node pushes right after listen() returns (parser flags,
// maxHeaderSize, clientError/connection callbacks): nothing was bound to accept them, so the
// restore-time bind has to apply them.
const http = require("node:http");
const net = require("node:net");
const server = http.createServer({ maxHeaderSize: 1024 }, (req, res) => {
  res.end("node ok");
});
let connections = 0;
server.on("connection", () => connections++);
server.on("clientError", (err, socket) => {
  console.log("[js] clientError:", err.code);
  socket.destroy();
});
server.listen(0, "127.0.0.1");
process.on("restore", async () => {
  const address = server.address();
  console.log("[js] restore address port type:", typeof address?.port);
  const res = await fetch(`http://127.0.0.1:${address.port}/`);
  console.log("[js] node fetch ->", await res.text(), "connection seen:", connections > 0);
  // maxHeaderSize (1024) survived into the restored bind: an oversized header trips the
  // parser limit, whose report also proves the clientError callback reached the new app.
  await fetch(`http://127.0.0.1:${address.port}/`, {
    headers: { "x-big": Buffer.alloc(4096, "a").toString() },
  }).then(
    r => console.log("[js] big header unexpectedly answered:", r.status),
    () => console.log("[js] big header rejected"),
  );
  const sock = net.connect(address.port, "127.0.0.1", () => sock.write("NOT A VALID REQUEST\r\n\r\n"));
  sock.on("close", () => server.close(() => process.exit(0)));
});
if (Bun.startupSnapshot.isBuildingSnapshot()) {
  // listen() ran but nothing is bound; give the JS listen machinery (next-tick
  // 'listening' emit, which reads the still-undefined port) a turn first.
  setTimeout(() => {
    console.log("[js] building address:", JSON.stringify(server.address()));
    Bun.startupSnapshot.take({ timers: "cancel" });
  }, 50);
}
