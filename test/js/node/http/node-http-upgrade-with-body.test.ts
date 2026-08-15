// node:http server 'upgrade' event with a request body (Node 26 semantics):
// head is the post-BODY remainder of the same TCP chunk, the body is already
// buffered on req with req.complete === true, and a peer FIN with an
// unsatisfied body tears the handed-off socket down instead of leaking the
// pending-request ref.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

type UpgradeResult = {
  head: string;
  reqData: string;
  sockData: string;
  completeAtUpgrade: boolean;
  readableLengthAtUpgrade: number;
};

function sendRaw(port: number, payload: string, thenEnd = false) {
  const sock = net.connect(port, "127.0.0.1", () => {
    sock.write(payload);
    if (thenEnd) sock.end();
  });
  sock.on("error", () => {});
  return sock;
}

async function observeUpgrade(payload: string): Promise<UpgradeResult> {
  const { promise, resolve, reject } = Promise.withResolvers<UpgradeResult>();
  const server = http.createServer((_req, res) => res.end());
  server.on("error", reject);
  server.on("clientError", reject);
  server.on("upgrade", (req, socket, head) => {
    const result: UpgradeResult = {
      head: head.toString(),
      reqData: "",
      sockData: "",
      completeAtUpgrade: req.complete,
      readableLengthAtUpgrade: req.readableLength,
    };
    req.on("data", d => (result.reqData += d));
    socket.on("data", d => (result.sockData += d));
    socket.on("error", reject);
    req.on("end", () => {
      // Resolve from socket 'close' so any late socket 'data' reaches sockData.
      socket.on("close", () => resolve(result));
      socket.end();
    });
  });
  await once(server.listen(0), "listening");
  const port = (server.address() as net.AddressInfo).port;
  const client = sendRaw(port, payload);
  client.on("end", () => client.end());
  try {
    return await promise;
  } finally {
    client.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }
}

describe("node:http 'upgrade' with a request body", () => {
  // a1/a2/a3: Content-Length body + tunnel bytes in the same chunk as the
  // headers. Node slices head to the post-body remainder, delivers the body
  // once through req, and does not surface the remainder on socket 'data'.
  test.concurrent("same-chunk Content-Length body: head is the post-body remainder", async () => {
    const result = await observeUpgrade(
      "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\nContent-Length: 5\r\n\r\nHELLOAFTER",
    );
    expect(result).toEqual({
      head: "AFTER",
      reqData: "HELLO",
      sockData: "",
      completeAtUpgrade: true,
      readableLengthAtUpgrade: 5,
    });
  });

  // Chunked body: the body is delivered once through req; the post-body
  // remainder reaches socket 'data' (head is not pre-computed for chunked).
  test.concurrent("same-chunk chunked body: body reaches req, remainder reaches socket 'data'", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{ head: string; reqData: string; sockData: string }>();
    const server = http.createServer((_req, res) => res.end());
    server.on("error", reject);
    server.on("clientError", reject);
    server.on("upgrade", (req, socket, head) => {
      let reqData = "";
      let sockData = "";
      req.on("data", d => (reqData += d));
      socket.on("error", reject);
      socket.on("data", d => {
        sockData += d;
        socket.end();
      });
      socket.on("close", () => resolve({ head: head.toString(), reqData, sockData }));
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as net.AddressInfo).port;
    const client = sendRaw(
      port,
      "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\nTransfer-Encoding: chunked\r\n\r\n" +
        "5\r\nHELLO\r\n0\r\n\r\nAFTER",
    );
    client.on("end", () => client.end());
    try {
      const { head, reqData, sockData } = await promise;
      expect({ reqData, delivered: head + sockData }).toEqual({ reqData: "HELLO", delivered: "AFTER" });
    } finally {
      client.destroy();
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Body fully in this chunk with nothing after it: head is empty and nothing
  // reaches socket 'data'.
  test.concurrent("same-chunk body with no remainder: head is empty", async () => {
    const result = await observeUpgrade(
      "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\nContent-Length: 5\r\n\r\nHELLO",
    );
    expect({ head: result.head, reqData: result.reqData, sockData: result.sockData }).toEqual({
      head: "",
      reqData: "HELLO",
      sockData: "",
    });
    expect(result.completeAtUpgrade).toBe(true);
  });

  // Headers-only first packet: 'upgrade' fires before the body, head is empty,
  // and once the body's fin arrives the post-body remainder in that later
  // packet reaches socket 'data' (not head).
  test.concurrent("split body: head is empty, later post-body bytes reach socket 'data'", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<UpgradeResult>();
    const server = http.createServer((_req, res) => res.end());
    server.on("error", reject);
    server.on("clientError", reject);
    server.on("upgrade", (req, socket, head) => {
      const result: UpgradeResult = {
        head: head.toString(),
        reqData: "",
        sockData: "",
        completeAtUpgrade: req.complete,
        readableLengthAtUpgrade: req.readableLength,
      };
      req.on("data", d => (result.reqData += d));
      socket.on("error", reject);
      socket.on("data", d => {
        result.sockData += d;
        socket.end();
      });
      socket.on("close", () => resolve(result));
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as net.AddressInfo).port;
    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    try {
      await once(client, "connect");
      client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\nContent-Length: 5\r\n\r\n");
      // Wait for 'upgrade' to fire before writing the body so it is not coalesced
      // into the header packet.
      await once(server, "upgrade");
      client.write("HELLOAFTER");
      client.on("end", () => client.end());
      const result = await promise;
      expect({ head: result.head, reqData: result.reqData, sockData: result.sockData }).toEqual({
        head: "",
        reqData: "HELLO",
        sockData: "AFTER",
      });
      expect(result.completeAtUpgrade).toBe(false);
    } finally {
      client.destroy();
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Same-chunk head, then more tunnel bytes in a later packet: the later bytes
  // reach socket 'data' (the head suppression is scoped to the one parse call).
  test.concurrent("later tunnel bytes after a same-chunk head reach socket 'data'", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{ head: string; reqData: string; sockData: string }>();
    const server = http.createServer((_req, res) => res.end());
    server.on("error", reject);
    server.on("clientError", reject);
    server.on("upgrade", (req, socket, head) => {
      let reqData = "";
      let sockData = "";
      req.on("data", d => (reqData += d));
      socket.on("error", reject);
      socket.on("data", d => {
        sockData += d;
        socket.end();
      });
      socket.on("close", () => resolve({ head: head.toString(), reqData, sockData }));
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as net.AddressInfo).port;
    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    try {
      await once(client, "connect");
      client.write(
        "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\nContent-Length: 5\r\n\r\nHELLOAFTER",
      );
      await once(server, "upgrade");
      client.write("MORE");
      client.on("end", () => client.end());
      const result = await promise;
      expect(result).toEqual({ head: "AFTER", reqData: "HELLO", sockData: "MORE" });
    } finally {
      client.destroy();
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Fallback-buffer path: a partial header block in one packet followed by a
  // large packet (> maxHeaderSize) with the rest of the headers + body + tunnel
  // tail. Every tunnel byte must reach the listener through head + socket 'data'
  // combined (the parser's fallback reassembly truncates the head view there, so
  // the post-body remainder is delivered via socket 'data' instead).
  test.concurrent("split header block + large tail: no tunnel bytes are dropped", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{ reqData: string; delivered: number }>();
    const TAIL_LEN = 20000;
    const tail = Buffer.alloc(TAIL_LEN, "X").toString();
    const server = http.createServer((_req, res) => res.end());
    server.on("error", reject);
    server.on("clientError", reject);
    server.on("upgrade", (req, socket, head) => {
      let reqData = "";
      let sockBytes = 0;
      req.on("data", d => (reqData += d));
      socket.on("data", d => (sockBytes += d.length));
      socket.on("error", reject);
      socket.on("end", () => socket.end());
      socket.on("close", () => resolve({ reqData, delivered: head.length + sockBytes }));
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as net.AddressInfo).port;
    // Set up before connecting: 'connection' can fire before the awaits below.
    const serverConnection = once(server, "connection");
    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    client.setNoDelay(true);
    try {
      await once(client, "connect");
      client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgra");
      await serverConnection;
      await new Promise<void>(r => setImmediate(r));
      client.write("de\r\nUpgrade: x\r\nContent-Length: 5\r\n\r\nHELLO" + tail);
      client.end();
      const { reqData, delivered } = await promise;
      expect({ reqData, delivered }).toEqual({ reqData: "HELLO", delivered: TAIL_LEN });
    } finally {
      client.destroy();
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // c: No-body control. Same as CONNECT: post-header bytes are the head.
  test.concurrent("no body: head is the post-header remainder", async () => {
    const result = await observeUpgrade("GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\nAFTER");
    expect({ head: result.head, reqData: result.reqData, sockData: result.sockData }).toEqual({
      head: "AFTER",
      reqData: "",
      sockData: "",
    });
  });

  // d1/d2: Declared body never arrives; the client FINs. Node destroys the
  // handed-off socket (socket 'close' fires) and server.close() completes.
  test.concurrent("peer FIN with unsatisfied body: socket closes and server.close() completes", async () => {
    const { promise: sockClosed, resolve: onSockClose, reject } = Promise.withResolvers<void>();
    const server = http.createServer((_req, res) => res.end());
    server.on("error", reject);
    server.on("upgrade", (req, socket) => {
      req.on("error", () => {});
      socket.on("error", reject);
      socket.on("close", onSockClose);
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as net.AddressInfo).port;
    const client = sendRaw(
      port,
      "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\nContent-Length: 5\r\n\r\n",
      true,
    );
    try {
      await sockClosed;
      await new Promise<void>(r => server.close(() => r()));
    } finally {
      client.destroy();
      server.close();
    }
  });

  // Same for a partially-sent body.
  test.concurrent("peer FIN with partial body: socket closes", async () => {
    const { promise: sockClosed, resolve: onSockClose, reject } = Promise.withResolvers<void>();
    const server = http.createServer((_req, res) => res.end());
    server.on("error", reject);
    server.on("upgrade", (req, socket) => {
      req.on("data", () => {});
      req.on("error", () => {});
      socket.on("error", reject);
      socket.on("close", onSockClose);
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as net.AddressInfo).port;
    const client = sendRaw(
      port,
      "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\nContent-Length: 5\r\n\r\nHE",
      true,
    );
    try {
      await sockClosed;
    } finally {
      client.destroy();
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

// b: With a completed same-chunk body the pending-request accounting is
// released once the handler ends the socket, so server.close() completes and
// the process exits. Spawned so a leak surfaces as a timeout here rather than
// hanging the suite.
test.concurrent("process exits after server.close() once an upgrade-with-body socket is ended", async () => {
  const src = `
    const http = require("node:http");
    const net = require("node:net");
    const server = http.createServer((_req, res) => res.end());
    server.on("upgrade", (req, socket) => {
      req.on("data", () => {});
      req.on("end", () => {
        socket.end();
        server.close(() => console.log("srvclose"));
      });
    });
    server.listen(0, () => {
      const c = net.connect(server.address().port, "127.0.0.1", () => {
        c.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: Upgrade\\r\\nUpgrade: x\\r\\nContent-Length: 5\\r\\n\\r\\nHELLO");
      });
      c.on("end", () => c.end());
    });
    setTimeout(() => { console.log("HANG"); process.exit(1); }, 3000).unref();
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("srvclose");
  expect(exitCode).toBe(0);
});
