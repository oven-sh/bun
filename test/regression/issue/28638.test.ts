import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import net from "node:net";

const host = "127.0.0.1";

test("error response sent to client when request body read fails due to client abort", async () => {
  const server = createServer(async (req, res) => {
    req.resume();
    req.on("end", function () {
      res.writeHead(204);
      res.end();
    });
    req.on("error", function () {
      res.writeHead(400);
      res.end();
    });
  }).listen(0, host);
  await once(server, "listening");
  try {
    const socket = net.connect(Number(server.address().port), host);
    await once(socket, "connect");
    const close = once(socket, "close");
    let data = "";
    socket.on("data", chunk => {
      data += chunk.toString();
    });
    socket.write(
      "POST / HTTP/1.1\r\n" +
        `Host: ${host}\r\n` +
        "Content-Type: text/plain\r\n" +
        "Content-Length: 1000\r\n" +
        "Connection: keep-alive\r\n" +
        "\r\n" +
        "pants",
    );
    socket.end();
    await close;
    expect(data.split("\r\n")[0]).toBe("HTTP/1.1 400 Bad Request");
  } finally {
    server.close();
  }
});

test("server handles abrupt client connection teardown gracefully", async () => {
  const { resolve, promise: errorHandled } = Promise.withResolvers();
  const server = createServer(async (req, res) => {
    req.resume();
    req.on("end", function () {
      res.writeHead(204);
      res.end();
    });
    req.on("error", function () {
      res.writeHead(400);
      res.end();
      resolve();
    });
  }).listen(0, host);
  await once(server, "listening");
  try {
    const socket = net.connect(Number(server.address().port), host);
    await once(socket, "connect");
    socket.write(
      "POST / HTTP/1.1\r\n" +
        `Host: ${host}\r\n` +
        "Content-Type: text/plain\r\n" +
        "Content-Length: 1000\r\n" +
        "Connection: keep-alive\r\n" +
        "\r\n" +
        "pants",
    );
    socket.destroy();
    await errorHandled;
    expect().pass();
  } finally {
    server.close();
  }
});
