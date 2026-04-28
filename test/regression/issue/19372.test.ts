import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("duplicate headers are joined per Node.js/RFC 9110 behavior", async () => {
  await using server = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        const result = JSON.stringify({
          // Custom headers: should be joined with ", "
          'x-test': req.headers['x-test'],
          // Known joinable header: should be joined with ", "
          'accept': req.headers['accept'],
          // Cookie: should be joined with "; "
          'cookie': req.headers['cookie'],
          // Content-Type: should keep first value only
          'content-type': req.headers['content-type'],
          // Host: should keep first value only
          'host': req.headers['host'],
          // Set-Cookie: already tested as array (not applicable for request headers typically)
          // rawHeaders should preserve all original headers
          'rawHeadersLength': req.rawHeaders.length,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(result);
        server.close();
      });
      server.listen(0, '127.0.0.1', () => {
        console.log(server.address().port);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = server.stdout.getReader();
  let portStr = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    portStr += new TextDecoder().decode(value);
    if (portStr.includes("\n")) break;
  }
  reader.releaseLock();
  const port = parseInt(portStr.trim(), 10);

  // Send request with duplicate headers using raw TCP to ensure they're sent as separate lines
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      data(socket, data) {
        socket.data += new TextDecoder().decode(data);
      },
      open(socket) {
        socket.data = "";
        const request = [
          "GET / HTTP/1.1",
          "Host: localhost",
          "Host: otherhost",
          "X-Test: Hello",
          "X-Test: World",
          "Accept: text/html",
          "Accept: application/json",
          "Cookie: a=1",
          "Cookie: b=2",
          "Content-Type: text/plain",
          "Content-Type: application/json",
          "Connection: close",
          "",
          "",
        ].join("\r\n");
        socket.write(request);
      },
      close() {},
      error() {},
      connectError() {},
    },
  });

  // Wait for the response
  const deadline = Date.now() + 5000;
  while (!socket.data?.includes("\r\n\r\n") || !socket.data?.includes("}")) {
    if (Date.now() > deadline) break;
    await Bun.sleep(50);
  }
  socket.end();

  // Parse the response body
  const body = socket.data.split("\r\n\r\n").slice(1).join("\r\n\r\n");
  const result = JSON.parse(body);

  // Custom headers (x-*): joined with ", "
  expect(result["x-test"]).toBe("Hello, World");

  // Known joinable headers: joined with ", "
  expect(result["accept"]).toBe("text/html, application/json");

  // Cookie: joined with "; "
  expect(result["cookie"]).toBe("a=1; b=2");

  // Content-Type: first value wins (drop duplicate)
  expect(result["content-type"]).toBe("text/plain");

  // Host: first value wins (drop duplicate)
  expect(result["host"]).toBe("localhost");

  // rawHeaders should contain all headers (including duplicates)
  // We sent 11 headers (Host x2, X-Test x2, Accept x2, Cookie x2, Content-Type x2, Connection x1)
  // Each header has name+value pair = 22 entries
  expect(result["rawHeadersLength"]).toBe(22);

  await server.exited;
});
