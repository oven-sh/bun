import { expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

test("req.socket.bytesRead counts headers and body (#28709)", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    atDispatch: number;
    atEnd: number;
    atClose: number;
  }>();
  const server = http.createServer((req, res) => {
    // The 'request' event fires after headers are parsed but before any body
    // chunk is delivered, so this samples the header-seeded value alone.
    const atDispatch = req.socket.bytesRead;
    let atEnd = 0;
    req.socket.once("close", () => {
      resolve({ atDispatch, atEnd, atClose: req.socket.bytesRead });
    });
    req.on("end", () => {
      atEnd = req.socket.bytesRead;
      res.end("ok");
    });
    req.on("error", reject);
    req.resume();
  });
  try {
    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(0, res);
    });
    const port = (server.address() as AddressInfo).port;
    // connection: close makes the server close the socket after responding,
    // so the 'close' sample exercises the close-time fold in #onClose.
    const clientReq = http.request({ method: "PUT", port, headers: { connection: "close" } });
    clientReq.on("error", reject);
    clientReq.write("hello");
    clientReq.end();
    const { atDispatch, atEnd, atClose } = await promise;
    // Header portion was seeded at request dispatch.
    expect(atDispatch).toBeGreaterThan(0);
    // Body bytes were accumulated on top of the header seed.
    expect(atEnd - atDispatch).toBe("hello".length);
    // The count survives the native handle being cleared at close.
    expect(atClose).toBe(atEnd);
  } finally {
    await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
  }
});

test("bytesRead survives a JS-initiated socket.destroy() (#28709)", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<{ atDispatch: number; atClose: number }>();
  const server = http.createServer(req => {
    const atDispatch = req.socket.bytesRead;
    req.socket.once("close", () => {
      resolve({ atDispatch, atClose: req.socket.bytesRead });
    });
    // destroy() routes through _destroy -> #closeHandle while the handle is
    // live, exercising that fold rather than #onClose's.
    req.socket.destroy();
  });
  try {
    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(0, res);
    });
    const port = (server.address() as AddressInfo).port;
    const clientReq = http.request({ method: "GET", port });
    // The server destroys the connection without responding; swallow the error.
    clientReq.on("error", () => {});
    clientReq.end();
    const { atDispatch, atClose } = await promise;
    expect(atDispatch).toBeGreaterThan(0);
    expect(atClose).toBe(atDispatch);
  } finally {
    await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
  }
});

test("socket.bytesRead counts CONNECT tunnel bytes (#28709)", async () => {
  const payload = "tunnel-payload";
  const { promise, resolve, reject } = Promise.withResolvers<{ seed: number; after: number }>();
  const server = http.createServer();
  server.on("connect", (req, socket, _head) => {
    const seed = socket.bytesRead;
    socket.once("data", () => {
      resolve({ seed, after: socket.bytesRead });
      socket.end();
    });
    socket.on("error", reject);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  });
  let client: net.Socket | undefined;
  try {
    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(0, res);
    });
    const port = (server.address() as AddressInfo).port;
    const c = (client = net.connect(port, "127.0.0.1", () => {
      c.write("CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n");
    }));
    c.on("error", reject);
    // Wait for the 200 before sending payload so it arrives as tunnel data
    // through #onData, not as pipelined head bytes.
    c.once("data", () => {
      c.write(payload);
    });
    const { seed, after } = await promise;
    // CONNECT request line + headers were seeded.
    expect(seed).toBeGreaterThan(0);
    // Tunnel bytes were accumulated on top of the seed.
    expect(after - seed).toBe(payload.length);
  } finally {
    client?.destroy();
    await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
  }
});

// For the hand-written canonical requests below, the native header
// reconstruction equals the wire byte length exactly, so the total can be
// asserted with ===.
test("socket.bytesRead counts CONNECT head bytes (#28709)", async () => {
  const request = "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n";
  const payload = "head-payload";
  const target = request.length + payload.length;
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = http.createServer();
  server.on("connect", (req, socket, _head) => {
    // The payload normally arrives as head bytes (same packet as the request);
    // if TCP split the write it arrives via 'data' instead. Both paths must
    // land in the counter.
    const check = () => {
      if (socket.bytesRead >= target) resolve(socket.bytesRead);
    };
    socket.on("data", check);
    socket.on("error", reject);
    check();
  });
  let client: net.Socket | undefined;
  try {
    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(0, res);
    });
    const port = (server.address() as AddressInfo).port;
    const c = (client = net.connect(port, "127.0.0.1", () => {
      // Single write: the payload lands in the request's pipelined head buffer.
      c.write(request + payload);
    }));
    c.on("error", reject);
    expect(await promise).toBe(target);
  } finally {
    client?.destroy();
    await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
  }
});

test("socket.bytesRead counts Upgrade head bytes (#28709)", async () => {
  const request = "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n";
  const payload = "upgrade-head";
  const target = request.length + payload.length;
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = http.createServer();
  server.on("upgrade", (req, socket, _head) => {
    const check = () => {
      if (socket.bytesRead >= target) resolve(socket.bytesRead);
    };
    socket.on("data", check);
    socket.on("error", reject);
    check();
  });
  let client: net.Socket | undefined;
  try {
    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(0, res);
    });
    const port = (server.address() as AddressInfo).port;
    const c = (client = net.connect(port, "127.0.0.1", () => {
      c.write(request + payload);
    }));
    c.on("error", reject);
    expect(await promise).toBe(target);
  } finally {
    client?.destroy();
    await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
  }
});
