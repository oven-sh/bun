import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { type AddressInfo, createServer, type Socket } from "node:net";
import path from "node:path";

test("WebSocket should send Blob data", async () => {
  await using server = Bun.serve({
    port: 0,
    websocket: {
      open(ws) {
        console.log("Server: WebSocket opened");
      },
      message(ws, message) {
        console.log("Server received:", message);
        // Echo back text messages
        ws.send(message);
      },
      close(ws) {
        console.log("Server: WebSocket closed");
      },
    },
    fetch(req, server) {
      if (server.upgrade(req)) {
        return undefined;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
  });

  const url = `ws://localhost:${server.port}`;

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ws = new WebSocket(url);
  ws.binaryType = "blob" as any;
  let messageReceived = false;

  ws.onopen = () => {
    console.log("Client: WebSocket opened");

    // Create a blob with test data
    const testData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" in bytes
    const blob = new Blob([testData], { type: "application/octet-stream" });

    console.log("Sending blob with length:", blob.size);
    ws.send(blob as any);
  };

  ws.onmessage = async event => {
    console.log("Client received message:", event.data);
    messageReceived = true;

    if (event.data instanceof Blob) {
      const received = new Uint8Array(await event.data.arrayBuffer());
      console.log("Received bytes:", Array.from(received));

      // Verify we received the correct data
      expect(received).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
      ws.close();
      resolve();
    } else {
      ws.close();
      reject(new Error("Expected blob data, got: " + typeof event.data));
    }
  };

  ws.onerror = error => {
    console.error("WebSocket error:", error);
    ws.close();
    reject(error);
  };

  ws.onclose = event => {
    console.log("Client: WebSocket closed", event.code, event.reason);
    if (!messageReceived) {
      reject(new Error("Connection closed without receiving message"));
    }
  };

  await promise;
});

test("WebSocket should send empty Blob", async () => {
  await using server = Bun.serve({
    port: 0,
    websocket: {
      message(ws, message) {
        // Echo back the message
        ws.send(message);
      },
    },
    fetch(req, server) {
      if (server.upgrade(req)) {
        return undefined;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
  });

  const url = `ws://localhost:${server.port}`;

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ws = new WebSocket(url);
  ws.binaryType = "blob" as any;
  let messageReceived = false;

  ws.onopen = () => {
    // Create an empty blob
    const blob = new Blob([], { type: "application/octet-stream" });

    console.log("Sending empty blob with length:", blob.size);
    ws.send(blob as any);
  };

  ws.onmessage = async event => {
    console.log("Client received message:", event.data);
    messageReceived = true;

    if (event.data instanceof Blob) {
      const received = new Uint8Array(await event.data.arrayBuffer());
      console.log("Received bytes length:", received.length);

      // Verify we received empty data
      expect(received.length).toBe(0);
      ws.close();
      resolve();
    } else {
      ws.close();
      reject(new Error("Expected blob data, got: " + typeof event.data));
    }
  };

  ws.onerror = error => {
    console.error("WebSocket error:", error);
    ws.close();
    reject(error);
  };

  ws.onclose = event => {
    console.log("Client: WebSocket closed", event.code, event.reason);
    if (!messageReceived) {
      reject(new Error("Connection closed without receiving message"));
    }
  };

  await promise;
});

test("WebSocket should ping with Blob", async () => {
  await using server = Bun.serve({
    port: 0,
    websocket: {
      ping(ws, data) {
        console.log("Server received ping with data:", data);
        // Respond with pong containing the same data
        ws.pong(data);
      },
    } as Bun.WebSocketHandler<undefined>,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return undefined;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
  });

  const url = `ws://localhost:${server.port}`;

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ws = new WebSocket(url);
  ws.binaryType = "blob" as any;
  let pongReceived = false;

  ws.onopen = () => {
    console.log("Client: WebSocket opened");

    // Create a blob with ping data
    const pingData = new Uint8Array([80, 73, 78, 71]); // "PING" in bytes
    const blob = new Blob([pingData], { type: "application/octet-stream" });

    console.log("Sending ping with blob");
    ws.ping(blob as any);
  };

  ws.addEventListener("pong", async (event: any) => {
    console.log("Client received pong:", event.data);
    pongReceived = true;

    if (event.data instanceof Blob) {
      const received = new Uint8Array(await event.data.arrayBuffer());

      // Verify we received the correct ping data back
      expect(new Uint8Array(received)).toEqual(new Uint8Array([80, 73, 78, 71]));
      ws.close();
      resolve();
    } else {
      ws.close();
      reject(new Error("Expected blob data in pong, got: " + typeof event.data));
    }
  });

  ws.onerror = error => {
    console.error("WebSocket error:", error);
    ws.close();
    reject(error);
  };

  ws.onclose = event => {
    console.log("Client: WebSocket closed", event.code, event.reason);
    if (!pongReceived) {
      reject(new Error("Connection closed without receiving pong"));
    }
  };

  await promise;
});

// A TCP peer that completes the WebSocket handshake and records every frame the client writes.
// A test can then tell "nothing was written" from "an empty frame was written".
async function rawPeer() {
  const seen: string[] = [];
  const sockets = new Set<Socket>();
  let wanted = 0;
  let enough: (() => void) | undefined;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    let pending = Buffer.alloc(0);
    let upgraded = false;
    socket.on("data", chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (!upgraded) {
        const end = pending.indexOf("\r\n\r\n");
        if (end < 0) return;
        const key = /sec-websocket-key: *([^\r\n]+)/i.exec(pending.toString("latin1"))![1];
        const accept = createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        upgraded = true;
        pending = pending.subarray(end + 4);
      }
      // A client frame: 2 header bytes, an optional 16-bit length, a 4-byte mask, the payload.
      while (pending.length >= 2) {
        const opcode = pending[0] & 0x0f;
        let length = pending[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (pending.length < 4) return;
          length = pending.readUInt16BE(2);
          offset = 4;
        }
        if (pending.length < offset + 4 + length) return;
        const mask = pending.subarray(offset, offset + 4);
        const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        pending = pending.subarray(offset + 4 + length);
        const kind = { 1: "text", 2: "binary", 8: "close", 9: "ping", 10: "pong" }[opcode] ?? `opcode${opcode}`;
        seen.push(kind === "text" ? `text:${payload}` : `${kind}:${length}`);
        if (seen.length >= wanted) enough?.();
      }
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    // Resolves once the peer has parsed `count` frames.
    frames(count: number) {
      const { promise, resolve } = Promise.withResolvers<void>();
      wanted = count;
      enough = resolve;
      if (seen.length >= count) resolve();
      return promise;
    },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
}

function opened(ws: WebSocket) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  ws.addEventListener("open", () => resolve(), { once: true });
  ws.addEventListener("error", event => reject((event as ErrorEvent).error ?? new Error("WebSocket error")), {
    once: true,
  });
  return promise;
}

function thrownBy(fn: () => void): { name: string; message: string } | undefined {
  try {
    fn();
  } catch (error) {
    const { name, message } = error as Error;
    return { name, message };
  }
  return undefined;
}

describe.concurrent("WebSocket client with an in-memory Blob", () => {
  test("send(), ping() and pong() write the bytes, and an empty Blob writes an empty frame", async () => {
    await using peer = await rawPeer();
    const ws = new WebSocket(peer.url);
    try {
      await opened(ws);
      const bytes = new Blob([new Uint8Array(100)]);
      const small = new Blob(["ping"]);
      const empty = new Blob([]);

      ws.send(bytes);
      ws.ping(small);
      ws.pong(small);
      ws.send(empty);
      ws.ping(empty);
      ws.pong(empty);

      await peer.frames(6);
      expect(peer.seen).toEqual(["binary:100", "ping:4", "pong:4", "binary:0", "ping:0", "pong:0"]);
    } finally {
      ws.terminate();
    }
  });

  test("a Blob sent after close() counts toward bufferedAmount like every other payload", async () => {
    await using peer = await rawPeer();
    const ws = new WebSocket(peer.url);
    try {
      await opened(ws);
      ws.close(1000);
      expect(ws.readyState).toBe(WebSocket.CLOSING);

      // A 100-byte payload and the 6 bytes of its frame header.
      const before = ws.bufferedAmount;
      ws.send(new Uint8Array(100));
      const afterBytes = ws.bufferedAmount;
      ws.send(new Blob([new Uint8Array(100)]));
      const afterBlob = ws.bufferedAmount;
      expect([afterBytes - before, afterBlob - afterBytes]).toEqual([106, 106]);
    } finally {
      ws.terminate();
    }
  });
});

// Bun.file(), fs.openAsBlob() and S3 blobs keep no bytes in memory, and send(), ping() and
// pong() cannot wait for a read. They must refuse such a Blob. They must not put an empty frame
// on the wire in its place.
describe.concurrent("WebSocket client with a file- or S3-backed Blob", () => {
  const refusal = (fn: string) => ({
    name: "TypeError",
    message: `${fn} cannot send a file- or S3-backed Blob synchronously; await blob.bytes() first`,
  });

  const blobKinds: [description: string, makeBlob: (file: string) => Blob | Promise<Blob>][] = [
    ["Bun.file()", file => Bun.file(file)],
    ["Bun.file().slice()", file => Bun.file(file).slice(0, 4)],
    ["fs.openAsBlob()", file => fs.openAsBlob(file)],
    [
      "S3Client.file()",
      () =>
        new Bun.S3Client({
          accessKeyId: "test",
          secretAccessKey: "test",
          region: "us-east-1",
          bucket: "my-bucket",
          endpoint: "http://localhost:1",
        }).file("payload.bin"),
    ],
  ];

  test.each(blobKinds)("%s: send(), ping() and pong() throw and write nothing", async (_, makeBlob) => {
    using dir = tempDir("ws-client-file-blob", { "payload.bin": "file-bytes" });
    const blob = await makeBlob(path.join(String(dir), "payload.bin"));
    await using peer = await rawPeer();
    const ws = new WebSocket(peer.url);
    try {
      await opened(ws);

      expect([thrownBy(() => ws.send(blob)), thrownBy(() => ws.ping(blob)), thrownBy(() => ws.pong(blob))]).toEqual([
        refusal("send"),
        refusal("ping"),
        refusal("pong"),
      ]);

      // The socket is still usable. A frame written for a refused payload would arrive first.
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.send("after");
      await peer.frames(1);
      expect(peer.seen).toEqual(["text:after"]);
    } finally {
      ws.terminate();
    }
  });

  test("the readyState checks still come first", async () => {
    using dir = tempDir("ws-client-file-blob", { "payload.bin": new Uint8Array(100) });
    const blob = Bun.file(path.join(String(dir), "payload.bin"));
    await using peer = await rawPeer();
    const ws = new WebSocket(peer.url);
    try {
      // While CONNECTING every payload type throws InvalidStateError.
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
      const invalidState = { name: "InvalidStateError", message: "The object is in an invalid state." };
      expect([thrownBy(() => ws.send(blob)), thrownBy(() => ws.ping(blob)), thrownBy(() => ws.pong(blob))]).toEqual([
        invalidState,
        invalidState,
        invalidState,
      ]);

      await opened(ws);
      ws.close(1000);

      // Once closing, every payload type is dropped without throwing. The size of this Blob is
      // not known without a read of the file, so it does not count toward bufferedAmount.
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      const before = ws.bufferedAmount;
      expect([thrownBy(() => ws.send(blob)), thrownBy(() => ws.ping(blob)), thrownBy(() => ws.pong(blob))]).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
      expect(ws.bufferedAmount - before).toBe(0);

      await peer.frames(1);
      expect(peer.seen).toEqual(["close:2"]);
    } finally {
      ws.terminate();
    }
  });
});
