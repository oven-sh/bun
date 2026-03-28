import { test, expect, describe } from "bun:test";
import http from "node:http";
import net from "node:net";

describe("http.ClientRequest upgrade event", () => {
  test("emits 'upgrade' event on 101 Switching Protocols", async () => {
    const { promise: serverReady, resolve: resolveServerReady } = Promise.withResolvers<number>();
    const { promise: done, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers<void>();

    // Raw TCP server that responds with 101 Switching Protocols
    const server = net.createServer((socket) => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: tcp\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n",
        );

        // Echo back data
        socket.on("data", (chunk) => {
          socket.write("echo:" + chunk.toString());
        });
      });
    });

    server.listen(0, () => {
      resolveServerReady((server.address() as net.AddressInfo).port);
    });

    try {
      const port = await serverReady;

      const req = http.request({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/attach",
        headers: {
          Connection: "Upgrade",
          Upgrade: "tcp",
        },
      });

      req.on("upgrade", (res, socket, head) => {
        try {
          expect(res.statusCode).toBe(101);
          expect(res.headers["upgrade"]).toBe("tcp");
          expect(head).toBeInstanceOf(Buffer);

          socket.write("hello");
          socket.on("data", (chunk: Buffer) => {
            try {
              expect(chunk.toString()).toBe("echo:hello");
              socket.destroy();
              resolveDone();
            } catch (e) {
              rejectDone(e);
            }
          });
        } catch (e) {
          rejectDone(e);
        }
      });

      req.on("response", () => {
        rejectDone(new Error("'response' event should not fire for 101"));
      });

      req.on("error", (err) => {
        rejectDone(err);
      });

      req.flushHeaders();

      await done;
    } finally {
      server.close();
    }
  });

  test("upgrade socket supports bidirectional streaming", async () => {
    const { promise: serverReady, resolve: resolveServerReady } = Promise.withResolvers<number>();
    const { promise: done, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers<void>();

    const server = net.createServer((socket) => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: tcp\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n",
        );

        // Server sends first, then echoes
        socket.write("server-hello\n");

        socket.on("data", (chunk) => {
          const msg = chunk.toString().trim();
          socket.write("reply:" + msg + "\n");
          if (msg === "done") {
            socket.end();
          }
        });
      });
    });

    server.listen(0, () => {
      resolveServerReady((server.address() as net.AddressInfo).port);
    });

    try {
      const port = await serverReady;

      const req = http.request({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/exec",
        headers: {
          Connection: "Upgrade",
          Upgrade: "tcp",
        },
      });

      req.on("upgrade", (_res, socket) => {
        const received: string[] = [];

        socket.setEncoding("utf-8");
        socket.on("data", (chunk: string) => {
          for (const line of chunk.split("\n").filter(Boolean)) {
            received.push(line);
            if (line === "server-hello") {
              socket.write("ping\n");
            } else if (line === "reply:ping") {
              socket.write("done\n");
            } else if (line === "reply:done") {
              // Server will close the connection
            }
          }
        });

        socket.on("end", () => {
          try {
            expect(received).toEqual(["server-hello", "reply:ping", "reply:done"]);
            resolveDone();
          } catch (e) {
            rejectDone(e);
          }
        });

        socket.on("error", rejectDone);
      });

      req.on("error", rejectDone);
      req.flushHeaders();

      await done;
    } finally {
      server.close();
    }
  });

  test("upgrade over unix socket", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const socketPath = path.join(os.tmpdir(), `bun-test-upgrade-${Date.now()}.sock`);

    const { promise: serverReady, resolve: resolveServerReady } = Promise.withResolvers<void>();
    const { promise: done, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers<void>();

    const server = net.createServer((socket) => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: tcp\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n",
        );

        socket.on("data", (chunk) => {
          socket.write("echo:" + chunk.toString());
        });
      });
    });

    server.listen(socketPath, () => {
      resolveServerReady();
    });

    try {
      await serverReady;

      const req = http.request({
        socketPath,
        method: "POST",
        path: "/v1.45/containers/test/attach?stdin=1&stdout=1&stream=1",
        headers: {
          Connection: "Upgrade",
          Upgrade: "tcp",
          "Content-Type": "application/json",
        },
      });

      req.on("upgrade", (res, socket) => {
        try {
          expect(res.statusCode).toBe(101);

          socket.write("test-data");
          socket.on("data", (chunk: Buffer) => {
            try {
              expect(chunk.toString()).toBe("echo:test-data");
              socket.destroy();
              resolveDone();
            } catch (e) {
              rejectDone(e);
            }
          });
        } catch (e) {
          rejectDone(e);
        }
      });

      req.on("error", rejectDone);
      req.flushHeaders();

      await done;
    } finally {
      server.close();
      try {
        fs.unlinkSync(socketPath);
      } catch {}
    }
  });

  test("req.end() with body before upgrade still works", async () => {
    const { promise: serverReady, resolve: resolveServerReady } = Promise.withResolvers<number>();
    const { promise: done, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers<void>();

    const server = net.createServer((socket) => {
      let buf = "";
      socket.on("data", (data) => {
        buf += data.toString();
        // Wait until we get the full HTTP request with body
        if (buf.includes("\r\n\r\n")) {
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: tcp\r\n" +
              "Connection: Upgrade\r\n" +
              "\r\n" +
              "welcome",
          );
        }
      });
    });

    server.listen(0, () => {
      resolveServerReady((server.address() as net.AddressInfo).port);
    });

    try {
      const port = await serverReady;

      const req = http.request({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/start",
        headers: {
          Connection: "Upgrade",
          Upgrade: "tcp",
        },
      });

      req.on("upgrade", (res, socket) => {
        try {
          expect(res.statusCode).toBe(101);

          socket.on("data", (chunk: Buffer) => {
            try {
              expect(chunk.toString()).toBe("welcome");
              socket.destroy();
              resolveDone();
            } catch (e) {
              rejectDone(e);
            }
          });
        } catch (e) {
          rejectDone(e);
        }
      });

      req.on("error", rejectDone);
      req.end('{"Tty":true}');

      await done;
    } finally {
      server.close();
    }
  });
});
