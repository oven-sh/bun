import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
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
  ws.binaryType = "blob";
  let messageReceived = false;

  ws.onopen = () => {
    console.log("Client: WebSocket opened");

    // Create a blob with test data
    const testData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" in bytes
    const blob = new Blob([testData], { type: "application/octet-stream" });

    console.log("Sending blob with length:", blob.size);
    ws.send(blob);
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
  ws.binaryType = "blob";
  let messageReceived = false;

  ws.onopen = () => {
    // Create an empty blob
    const blob = new Blob([], { type: "application/octet-stream" });

    console.log("Sending empty blob with length:", blob.size);
    ws.send(blob);
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
  ws.binaryType = "blob";
  let pongReceived = false;

  ws.onopen = () => {
    console.log("Client: WebSocket opened");

    // Create a blob with ping data
    const pingData = new Uint8Array([80, 73, 78, 71]); // "PING" in bytes
    const blob = new Blob([pingData], { type: "application/octet-stream" });

    console.log("Sending ping with blob");
    ws.ping(blob);
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

// Bun.file() and S3 blobs keep no bytes in memory. The client send paths are
// synchronous, so (like ServerWebSocket) they must throw instead of putting an
// empty frame on the wire in place of the payload.
describe("WebSocket client with a file- or S3-backed Blob", () => {
  const rejection = (fn: string) => ({
    name: "TypeError",
    message: `${fn} cannot send a file- or S3-backed Blob synchronously; await blob.bytes() first`,
  });

  // Records every frame the server receives, so a test can prove that a rejected
  // payload did not go out as an empty frame. The server closes the connection
  // once it receives the "done" text message.
  function serveRecordingFrames() {
    const received: string[] = [];
    const server = Bun.serve({
      port: 0,
      websocket: {
        message(ws, message) {
          received.push(typeof message === "string" ? `text:${message}` : `binary:${message.length}`);
          if (message === "done") ws.close();
        },
        ping(_ws, data) {
          received.push(`ping:${data.length}`);
        },
        pong(_ws, data) {
          received.push(`pong:${data.length}`);
        },
      },
      fetch(req, server) {
        if (server.upgrade(req)) return undefined;
        return new Response("Upgrade failed", { status: 500 });
      },
    });
    return { server, received };
  }

  function connect(server: Bun.Server<undefined>) {
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    const opened = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    ws.onopen = () => opened.resolve();
    ws.onerror = event => opened.reject((event as ErrorEvent).error ?? new Error("WebSocket error"));
    ws.onclose = () => closed.resolve();
    return { ws, opened: opened.promise, closed: closed.promise };
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

  const blobKinds: [description: string, makeBlob: (dir: string) => Blob][] = [
    ["Bun.file()", dir => Bun.file(path.join(dir, "payload.bin"))],
    ["Bun.file().slice()", dir => Bun.file(path.join(dir, "payload.bin")).slice(0, 4)],
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

  test.concurrent.each(blobKinds)("%s: send(), ping() and pong() throw and send nothing", async (_, makeBlob) => {
    using dir = tempDir("ws-client-file-blob", { "payload.bin": "file-bytes" });
    const blob = makeBlob(String(dir));
    const recording = serveRecordingFrames();
    await using server = recording.server;
    const { ws, opened, closed } = connect(server);
    await opened;

    expect([thrownBy(() => ws.send(blob)), thrownBy(() => ws.ping(blob)), thrownBy(() => ws.pong(blob))]).toEqual([
      rejection("send"),
      rejection("ping"),
      rejection("pong"),
    ]);

    // The connection is still usable, and nothing went out in place of the rejected payloads.
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.send("done");
    await closed;
    expect(recording.received).toEqual(["text:done"]);
  });

  test.concurrent("the readyState checks still come first", async () => {
    using dir = tempDir("ws-client-file-blob", { "payload.bin": "file-bytes" });
    const blob = Bun.file(path.join(String(dir), "payload.bin"));
    const recording = serveRecordingFrames();
    await using server = recording.server;
    const { ws, opened, closed } = connect(server);

    // While CONNECTING every payload type throws InvalidStateError.
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    expect(thrownBy(() => ws.send(blob))).toEqual({
      name: "InvalidStateError",
      message: "The object is in an invalid state.",
    });

    await opened;
    ws.send("done");
    await closed;

    // Once closed, every payload type is dropped without throwing.
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect([thrownBy(() => ws.send(blob)), thrownBy(() => ws.ping(blob)), thrownBy(() => ws.pong(blob))]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(recording.received).toEqual(["text:done"]);
  });
});
