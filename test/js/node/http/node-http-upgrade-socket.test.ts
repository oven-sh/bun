import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

const fixturesDir = path.join(import.meta.dir, "fixtures");

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
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
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

  test("socket.bytesWritten reflects actual bytes sent", async () => {
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
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");

          const response = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Accept: " + accept,
            "",
            "",
          ].join("\\r\\n");

          socket.write(response, () => {
            console.log("bytesWritten:" + socket.bytesWritten);
            console.log("expected:" + Buffer.byteLength(response));
            socket.destroy();
            server.close();
          });
        });

        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const key = crypto.randomBytes(16).toString("base64");
          const socket = net.createConnection(port, "127.0.0.1", () => {
            socket.write(
              "GET / HTTP/1.1\\r\\nHost: 127.0.0.1:" + port + "\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: " + key + "\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n"
            );
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

    const actualMatch = stdout.match(/bytesWritten:(\d+)/);
    const expectedMatch = stdout.match(/expected:(\d+)/);
    expect(actualMatch).not.toBeNull();
    expect(expectedMatch).not.toBeNull();
    expect(Number(actualMatch![1])).toBe(Number(expectedMatch![1]));
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
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
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
              // Send raw data after upgrade handshake
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
          // No upgrade listener — this should fire for upgrade requests too
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
              // Node.js responds with 200 OK when there are no upgrade listeners
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

  test("upgrade works over HTTPS/TLS", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const https = require("node:https");
        const tls = require("node:tls");
        const crypto = require("node:crypto");
        const fs = require("node:fs");

        const certDir = ${JSON.stringify(fixturesDir)};
        const key = fs.readFileSync(certDir + "/cert.key", "utf8");
        const cert = fs.readFileSync(certDir + "/cert.pem", "utf8");

        const server = https.createServer({ key, cert }, (_req, res) => {
          res.writeHead(200);
          res.end("OK");
        });

        server.on("upgrade", (req, socket, _head) => {
          const key = req.headers["sec-websocket-key"];
          const accept = crypto
            .createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
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

          // Echo data back
          socket.on("data", (chunk) => {
            socket.write(chunk);
          });
        });

        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const key = crypto.randomBytes(16).toString("base64");
          const client = tls.connect(port, "127.0.0.1", { rejectUnauthorized: false }, () => {
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
              client.write("tls echo test");
            } else if (phase === "echo") {
              if (buf === "tls echo test") {
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

  test("socket.pipe() works for proxying after upgrade", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const net = require("node:net");
        const crypto = require("node:crypto");

        // Upstream server: accepts raw TCP, echoes back with a prefix
        const upstream = net.createServer((conn) => {
          conn.on("data", (chunk) => {
            conn.write("echo:" + chunk.toString());
          });
        });

        // Proxy server: upgrades HTTP, then pipes to upstream
        const proxy = http.createServer((_req, res) => {
          res.writeHead(200);
          res.end("OK");
        });

        proxy.on("upgrade", (req, clientSocket, _head) => {
          const key = req.headers["sec-websocket-key"];
          const accept = crypto
            .createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");

          const response = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Accept: " + accept,
            "",
            "",
          ].join("\\r\\n");

          clientSocket.write(response);

          // Connect to upstream and pipe bidirectionally
          const upstreamPort = upstream.address().port;
          const upstreamConn = net.createConnection(upstreamPort, "127.0.0.1", () => {
            clientSocket.pipe(upstreamConn);
            upstreamConn.pipe(clientSocket);
          });

          clientSocket.on("error", () => upstreamConn.destroy());
          upstreamConn.on("error", () => clientSocket.destroy());
          clientSocket.on("close", () => upstreamConn.destroy());
          upstreamConn.on("close", () => clientSocket.destroy());
        });

        upstream.listen(0, "127.0.0.1", () => {
          proxy.listen(0, "127.0.0.1", () => {
            const port = proxy.address().port;
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
                  proxy.close();
                  upstream.close();
                  return;
                }
                phase = "proxy";
                buf = "";
                client.write("proxy test");
              } else if (phase === "proxy") {
                if (buf === "echo:proxy test") {
                  console.log("PASS");
                  client.destroy();
                  proxy.close();
                  upstream.close();
                }
              }
            });
            client.on("error", (err) => {
              console.log("FAIL: " + err.message);
              proxy.close();
              upstream.close();
            });
            client.setTimeout(3000, () => {
              client.destroy();
              console.log("FAIL: timeout in phase " + phase);
              proxy.close();
              upstream.close();
            });
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
});
