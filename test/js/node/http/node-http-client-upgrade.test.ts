// Tests for the client side of HTTP/1.1 upgrades: http.request() must emit
// 'upgrade' (not 'response') for 101 Switching Protocols and hand over a
// working duplex socket.
// https://github.com/oven-sh/bun/issues/32195
// https://github.com/oven-sh/bun/issues/18945
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const HANDSHAKE = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";

// Raw TCP server speaking just enough HTTP to answer an upgrade request, so
// these tests exercise only the client (the node:http server has its own
// upgrade handling).
function rawUpgradeServer(
  onRequest: (socket: net.Socket) => void,
  options?: { tls?: boolean },
): Promise<{ port: number; server: net.Server }> {
  const connect = (socket: net.Socket) => {
    let buffered = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString("latin1");
      if (!buffered.includes("\r\n\r\n")) return;
      socket.removeListener("data", onData);
      onRequest(socket);
    };
    socket.on("data", onData);
    socket.on("error", () => {});
  };
  const server = options?.tls ? tls.createServer({ key: tlsCert.key, cert: tlsCert.cert }, connect) : net.createServer(connect);
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: (server.address() as net.AddressInfo).port, server });
    });
  });
}

const upgradeHeaders = { Connection: "Upgrade", Upgrade: "websocket" };

describe.concurrent("http.ClientRequest upgrade", () => {
  test("emits 'upgrade' with a working duplex socket", async () => {
    const { port, server } = await rawUpgradeServer(socket => {
      socket.write(HANDSHAKE);
      socket.on("data", chunk => socket.write(chunk)); // echo
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const req = http.request({ port, host: "127.0.0.1", headers: upgradeHeaders });
      req.on("error", reject);
      req.on("response", () => reject(new Error("unexpected 'response' event")));
      req.end();

      req.on("upgrade", (res, socket, head) => {
        try {
          expect(res.statusCode).toBe(101);
          expect(res.headers.upgrade).toBe("websocket");
          expect(res.complete).toBe(true);
          expect(Buffer.isBuffer(head)).toBe(true);
          expect(socket).toBe(req.socket);
        } catch (err) {
          reject(err);
          return;
        }

        let received = "";
        if (head.length > 0) socket.unshift(head);
        socket.on("data", chunk => {
          received += chunk.toString();
          if (received === "helloworld") {
            socket.end();
          }
        });
        socket.on("error", reject);
        socket.on("close", () => resolve(received));
        // Two synchronous writes: both must arrive, in order.
        socket.write("hello");
        socket.write("world");
      });

      expect(await promise).toBe("helloworld");
    } finally {
      server.close();
    }
  });

  test("event order matches Node: socket, finish, upgrade, close", async () => {
    const { port, server } = await rawUpgradeServer(socket => {
      socket.write(HANDSHAKE);
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<string[]>();
      const events: string[] = [];
      const req = http.request({ port, host: "127.0.0.1", headers: upgradeHeaders });
      for (const name of ["socket", "finish", "response", "error", "abort"]) {
        req.on(name, () => events.push(name));
      }
      req.on("upgrade", (_res, socket) => {
        events.push("upgrade");
        socket.destroy();
      });
      req.on("close", () => {
        events.push("close");
        resolve(events);
      });
      req.on("error", reject);
      req.end();

      expect(await promise).toEqual(["socket", "finish", "upgrade", "close"]);
      expect(req.destroyed).toBe(true);
    } finally {
      server.close();
    }
  });

  test("destroys the connection when there is no 'upgrade' listener", async () => {
    const serverSawClose = Promise.withResolvers<void>();
    const { port, server } = await rawUpgradeServer(socket => {
      socket.write(HANDSHAKE);
      socket.on("close", () => serverSawClose.resolve());
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = http.request({ port, host: "127.0.0.1", headers: upgradeHeaders });
      req.on("response", () => reject(new Error("unexpected 'response' event")));
      req.on("error", reject);
      req.on("close", resolve);
      req.end();

      await promise;
      await serverSawClose.promise;
      expect(req.destroyed).toBe(true);
    } finally {
      server.close();
    }
  });

  test("bytes sent in the same packet as the 101 reach the socket", async () => {
    const { port, server } = await rawUpgradeServer(socket => {
      // handshake and first payload in a single write
      socket.end(HANDSHAKE + "early-data");
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const req = http.request({ port, host: "127.0.0.1", headers: upgradeHeaders });
      req.on("error", reject);
      req.end();
      req.on("upgrade", (_res, socket, head) => {
        let received = "";
        if (head.length > 0) socket.unshift(head);
        socket.on("data", chunk => (received += chunk.toString()));
        socket.on("end", () => resolve(received));
        socket.on("error", reject);
      });

      expect(await promise).toBe("early-data");
    } finally {
      server.close();
    }
  });

  test("a regular response to an upgrade request still emits 'response' and completes", async () => {
    const { port, server } = await rawUpgradeServer(socket => {
      socket.end("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 8\r\n\r\nrejected");
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<{ statusCode: number | undefined; body: string }>();
      const req = http.request({ port, host: "127.0.0.1", headers: upgradeHeaders });
      req.on("upgrade", () => reject(new Error("unexpected 'upgrade' event")));
      req.on("error", reject);
      req.on("response", res => {
        let body = "";
        res.on("data", chunk => (body += chunk.toString()));
        res.on("end", () => resolve({ statusCode: res.statusCode, body }));
        res.on("error", reject);
      });
      req.end();

      expect(await promise).toEqual({ statusCode: 200, body: "rejected" });
    } finally {
      server.close();
    }
  });

  test("upgrade works on a request started with flushHeaders() and no end()", async () => {
    const { port, server } = await rawUpgradeServer(socket => {
      socket.write(HANDSHAKE);
      socket.on("data", chunk => socket.write(chunk)); // echo
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const req = http.request({ port, host: "127.0.0.1", method: "POST", headers: upgradeHeaders });
      req.on("error", reject);
      req.on("response", () => reject(new Error("unexpected 'response' event")));
      // dockerode-style: send the headers, keep the upload half open, never
      // call req.end().
      req.flushHeaders();

      req.on("upgrade", (_res, socket) => {
        let received = "";
        socket.on("data", chunk => {
          received += chunk.toString();
          if (received === "hijacked") socket.end();
        });
        socket.on("error", reject);
        socket.on("close", () => resolve(received));
        socket.write("hijacked");
      });

      expect(await promise).toBe("hijacked");
    } finally {
      server.close();
    }
  });

  test("upgrade works over TLS", async () => {
    const { port, server } = await rawUpgradeServer(
      socket => {
        socket.write(HANDSHAKE);
        socket.on("data", chunk => socket.write(chunk)); // echo
      },
      { tls: true },
    );

    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const req = https.request({
        port,
        host: "127.0.0.1",
        headers: upgradeHeaders,
        ca: tlsCert.cert,
        rejectUnauthorized: false,
      });
      req.on("error", reject);
      req.on("response", () => reject(new Error("unexpected 'response' event")));
      req.end();
      req.on("upgrade", (_res, socket) => {
        expect(socket.encrypted).toBe(true);
        let received = "";
        socket.on("data", chunk => {
          received += chunk.toString();
          if (received === "secure-echo") socket.end();
        });
        socket.on("close", () => resolve(received));
        socket.on("error", reject);
        socket.write("secure-echo");
      });

      expect(await promise).toBe("secure-echo");
    } finally {
      server.close();
    }
  });

  // The shape from the issue: the whole exchange in a child process, proving
  // the runtime does not hang and exits on its own once the socket closes.
  test("upgrade client does not hang the process", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const net = require("node:net");
        const http = require("node:http");

        const server = net.createServer(socket => {
          let buffered = "";
          socket.on("data", chunk => {
            buffered += chunk;
            if (!buffered.includes("\\r\\n\\r\\n")) return;
            socket.write(${JSON.stringify(HANDSHAKE)});
            socket.pipe(socket); // echo
          });
        });

        server.listen(0, "127.0.0.1", () => {
          const req = http.request({
            port: server.address().port,
            host: "127.0.0.1",
            headers: { Connection: "Upgrade", Upgrade: "websocket" },
          });
          req.end();
          req.on("upgrade", (res, socket, head) => {
            console.log("got upgraded!");
            socket.end();
            server.close();
          });
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // stderr is drained but not asserted: debug/ASAN builds emit benign noise.
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "got upgraded!\n", exitCode: 0 });
  });
});
