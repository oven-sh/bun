// node:http listens through Bun.serve, so a server created before the snapshot defers its bind too.
const http = require("node:http");
const server = http.createServer((req, res) => {
  res.end("node ok");
});
server.listen(0, "127.0.0.1");
process.on("restore", async () => {
  const address = server.address();
  console.log("[js] restore address port type:", typeof address?.port);
  const res = await fetch(`http://127.0.0.1:${address.port}/`);
  console.log("[js] node fetch ->", await res.text());
  server.close(() => process.exit(0));
});
if (Bun.startupSnapshot.isBuildingSnapshot()) {
  // listen() ran but nothing is bound; give the JS listen machinery (next-tick
  // 'listening' emit, which reads the still-undefined port) a turn first.
  setTimeout(() => {
    console.log("[js] building address:", JSON.stringify(server.address()));
    Bun.startupSnapshot.take({ timers: "cancel" });
  }, 50);
}
