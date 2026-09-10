const http = require("node:http");

const s = http.createServer((req, res) => res.end("hello-fd0"));
s.on("error", e => {
  console.error("listen error:", e.code);
  process.exit(3);
});
s.listen({ fd: 0 }, () => console.log("ready"));
