import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("node:http server upgrade", () => {
  test("socket.write() sends data to the client", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const net = require("node:net");
        const crypto = require("node:crypto");

        const server = http.createServer((_req, res) => {
          res.writeHead(200);
          res.end("OK");
        });

        server.on("upgrade", (req, socket, _head) => {
          const key = req.headers["sec-websocket-key"];
          const accept = crypto
            .createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-5AB53ADF711E2")
            .digest("base64");

          const response = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Accept: " + accept,
            "",
            "",
          ].join("\\r\\n");

          socket.write(response);
        });

        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const key = crypto.randomBytes(16).toString("base64");
          const socket = net.createConnection(port, "127.0.0.1", () => {
            socket.write(
              "GET / HTTP/1.1\\r\\nHost: 127.0.0.1:" + port + "\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: " + key + "\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n"
            );
          });

          let buf = "";
          socket.on("data", (chunk) => {
            buf += chunk.toString();
            if (buf.includes("\\r\\n\\r\\n")) {
              socket.destroy();
              const status = buf.split("\\r\\n")[0];
              if (status.includes("101")) {
                console.log("PASS");
              } else {
                console.log("FAIL: " + status);
              }
              server.close();
            }
          });
          socket.on("error", (err) => {
            console.log("FAIL: " + err.message);
            server.close();
          });
          socket.setTimeout(3000, () => {
            socket.destroy();
            console.log("FAIL: timeout");
            server.close();
          });
        });
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });

  test("bidirectional communication after upgrade", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const net = require("node:net");
        const crypto = require("node:crypto");

        const server = http.createServer((_req, res) => {
          res.writeHead(200);
          res.end("OK");
        });

        server.on("upgrade", (req, socket, _head) => {
          const key = req.headers["sec-websocket-key"];
          const accept = crypto
            .createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-5AB53ADF711E2")
            .digest("base64");

          const response = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Accept: " + accept,
            "",
            "",
          ].join("\\r\\n");

          socket.write(response);

          // Echo data back after upgrade
          socket.on("data", (chunk) => {
            socket.write(chunk);
          });
          socket.on("end", () => {
            socket.end();
          });
        });

        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const key = crypto.randomBytes(16).toString("base64");
          const client = net.createConnection(port, "127.0.0.1", () => {
            client.write(
              "GET / HTTP/1.1\\r\\nHost: 127.0.0.1:" + port + "\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: " + key + "\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n"
            );
          });

          let phase = "handshake";
          let buf = "";
          client.on("data", (chunk) => {
            buf += chunk.toString();
            if (phase === "handshake" && buf.includes("\\r\\n\\r\\n")) {
              const status = buf.split("\\r\\n")[0];
              if (!status.includes("101")) {
                console.log("FAIL: handshake " + status);
                client.destroy();
                server.close();
                return;
              }
              phase = "echo";
              buf = "";
              client.write("hello from client");
            } else if (phase === "echo") {
              if (buf === "hello from client") {
                console.log("PASS");
                client.destroy();
                server.close();
              }
            }
          });
          client.on("error", (err) => {
            console.log("FAIL: " + err.message);
            server.close();
          });
          client.setTimeout(3000, () => {
            client.destroy();
            console.log("FAIL: timeout in phase " + phase);
            server.close();
          });
        });
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });

  test("upgrade request with no listeners falls through to request event", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const net = require("node:net");
        const crypto = require("node:crypto");

        const server = http.createServer((_req, res) => {
          console.log("request-event");
          res.writeHead(200);
          res.end("OK");
        });
        // Intentionally NO server.on("upgrade", ...) listener

        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const key = crypto.randomBytes(16).toString("base64");
          const socket = net.createConnection(port, "127.0.0.1", () => {
            socket.write(
              "GET / HTTP/1.1\\r\\nHost: 127.0.0.1:" + port + "\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: " + key + "\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n"
            );
          });

          let buf = "";
          socket.on("data", (chunk) => {
            buf += chunk.toString();
            if (buf.includes("\\r\\n\\r\\n")) {
              socket.destroy();
              const status = buf.split("\\r\\n")[0];
              console.log("status:" + status);
              server.close();
            }
          });
          socket.on("error", (err) => {
            console.log("FAIL: " + err.message);
            server.close();
          });
          socket.setTimeout(3000, () => {
            socket.destroy();
            console.log("FAIL: timeout");
            server.close();
          });
        });
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.trim().split("\n");
    expect(lines.find(l => l.startsWith("FAIL:"))).toBeUndefined();
    expect(lines).toContain("request-event");
    expect(lines.find(l => l.startsWith("status:"))).toBe("status:HTTP/1.1 200 OK");
    expect(exitCode).toBe(0);
  });
});
