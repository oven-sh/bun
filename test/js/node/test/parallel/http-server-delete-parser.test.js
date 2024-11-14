//#FILE: test-http-server-delete-parser.js
//#SHA1: 49465ae50d9dac34e834dcb19c02e75b284acdc2
//-----------------
"use strict";

const http = require("http");

test("HTTP server deletes parser after write", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("okay", () => {
      delete res.socket.parser;
    });
    res.end();
  });

  await new Promise(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();

  const req = http.request({
    port,
    host: "127.0.0.1",
    method: "GET",
  });

  await new Promise(resolve => {
    req.end(resolve);
  });

  server.close();
});

//<#END_FILE: test-http-server-delete-parser.js
