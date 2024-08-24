//#FILE: test-http-missing-header-separator-cr.js
//#SHA1: 6e213764778e9edddd0fc6a43c9a3183507054c6
//-----------------
"use strict";

const http = require("http");
const net = require("net");

function serverHandler(server, msg) {
  const client = net.connect(server.address().port, "localhost");

  let response = "";

  client.on("data", chunk => {
    response += chunk;
  });

  client.setEncoding("utf8");
  client.on("error", () => {
    throw new Error("Client error should not occur");
  });
  client.on("end", () => {
    expect(response).toBe("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    server.close();
  });
  client.write(msg);
  client.resume();
}

test("GET request with invalid header", async () => {
  const msg = [
    "GET / HTTP/1.1",
    "Host: localhost",
    "Dummy: x\nContent-Length: 23",
    "",
    "GET / HTTP/1.1",
    "Dummy: GET /admin HTTP/1.1",
    "Host: localhost",
    "",
    "",
  ].join("\r\n");

  const server = http.createServer(() => {
    throw new Error("Server should not be called");
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      serverHandler(server, msg);
      resolve();
    });
  });
});

test("POST request with invalid Transfer-Encoding header", async () => {
  const msg = ["POST / HTTP/1.1", "Host: localhost", "x:x\nTransfer-Encoding: chunked", "", "1", "A", "0", "", ""].join(
    "\r\n",
  );

  const server = http.createServer(() => {
    throw new Error("Server should not be called");
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      serverHandler(server, msg);
      resolve();
    });
  });
});

test("POST request with invalid header and Transfer-Encoding", async () => {
  const msg = ["POST / HTTP/1.1", "Host: localhost", "x:\nTransfer-Encoding: chunked", "", "1", "A", "0", "", ""].join(
    "\r\n",
  );

  const server = http.createServer(() => {
    throw new Error("Server should not be called");
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      serverHandler(server, msg);
      resolve();
    });
  });
});

//<#END_FILE: test-http-missing-header-separator-cr.js
