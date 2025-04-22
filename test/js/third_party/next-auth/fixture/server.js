import net from "net";
import { parse } from "url";
import http from "http";
import next from "next";
import { expect } from "bun:test";
function test(port) {
  const payload = Buffer.from(JSON.stringify({ message: "bun" }));

  function sendRequest(socket) {
    const { promise, resolve } = Promise.withResolvers();
    let first = true;
    socket.on("data", data => {
      if (first) {
        first = false;
        const statusText = data.toString("utf8").split("HTTP/1.1")[1]?.split("\r\n")[0]?.trim();
        try {
          expect(statusText).toBe("200 OK");
          resolve();
        } catch (err) {
          console.error(err);
          process.exit(1);
        }
      }
    });
    socket.write(
      `POST /api/echo HTTP/1.1\r\nHost: localhost:8080\r\nConnection: keep-alive\r\nContent-Length: ${payload.byteLength}\r\n\r\n`,
    );
    socket.write(payload);

    return promise;
  }
  const socket = net.connect({ port: port, host: "127.0.0.1" }, async () => {
    const timer = setTimeout(() => {
      console.error("timeout");
      process.exit(1);
    }, 30_000).unref();
    await sendRequest(socket);
    await sendRequest(socket);
    await sendRequest(socket);
    console.log("request sent");
    clearTimeout(timer);
    process.exit(0);
  });
  socket.on("error", err => {
    console.error(err);
    process.exit(1);
  });
}

const app = next({ dev: true, dir: import.meta.dirname, quiet: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http
    .createServer((req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    })
    .listen(0, "127.0.0.1", () => {
      console.log("server listening", server.address().port);
      test(server.address().port);
    });
});
