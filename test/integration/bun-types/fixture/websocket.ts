import { expectType } from "./utilities";

// WebSocket constructor tests
{
  // Constructor with string URL only
  new WebSocket("wss://dev.local");

  // Constructor with string URL and protocols array
  new WebSocket("wss://dev.local", ["proto1", "proto2"]);

  // Constructor with string URL and single protocol string
  new WebSocket("wss://dev.local", "proto1");

  // Constructor with URL object only
  new WebSocket(new URL("wss://dev.local"));

  // Constructor with URL object and protocols array
  new WebSocket(new URL("wss://dev.local"), ["proto1", "proto2"]);

  // Constructor with URL object and single protocol string
  new WebSocket(new URL("wss://dev.local"), "proto1");

  // Constructor with string URL and options object with protocols
  new WebSocket("wss://dev.local", {
    protocols: ["proto1", "proto2"],
  });

  // Constructor with string URL and options object with protocol
  new WebSocket("wss://dev.local", {
    protocol: "proto1",
  });

  // Constructor with URL object and options with TLS settings
  new WebSocket(new URL("wss://dev.local"), {
    protocol: "proto1",
    tls: {
      rejectUnauthorized: false,
    },
  });

  // Constructor with headers
  new WebSocket("wss://dev.local", {
    headers: {
      "Cookie": "session=123456",
      "User-Agent": "BunWebSocketTest",
    },
  });

  // Constructor with full options object
  new WebSocket("wss://dev.local", {
    protocols: ["proto1", "proto2"],
    headers: {
      "Cookie": "session=123456",
    },
    tls: {
      rejectUnauthorized: true,
    },
  });
}

// Assignability test
{
  function toAny<T>(value: T): any {
    return value;
  }

  const AnySocket = toAny(WebSocket);

  const ws: WebSocket = new AnySocket("wss://dev.local");

  ws.close();
  ws.addEventListener("open", e => expectType(e).is<Event>());
  ws.addEventListener("message", e => expectType(e).is<MessageEvent>());
  ws.addEventListener("message", (e: MessageEvent<string>) => expectType(e).is<MessageEvent<string>>());
  ws.addEventListener("message", (e: MessageEvent<string>) => expectType(e.data).is<string>());
}

// WebSocket static properties test
{
  expectType(WebSocket.CONNECTING).is<0>();
  expectType(WebSocket.OPEN).is<1>();
  expectType(WebSocket.CLOSING).is<2>();
  expectType(WebSocket.CLOSED).is<3>();

  const instance: WebSocket = null as never;
  expectType(instance.CONNECTING).is<0>();
  expectType(instance.OPEN).is<1>();
  expectType(instance.CLOSING).is<2>();
  expectType(instance.CLOSED).is<3>();
}

// WebSocket event handlers test
{
  const ws = new WebSocket("wss://dev.local");

  // Using event handler properties
  ws.onopen = (event: Event) => {
    expectType(event).is<Event>();
  };

  ws.onmessage = (event: MessageEvent<string>) => {
    expectType(event.data).is<string>();
  };

  ws.onerror = (event: Event) => {
    expectType(event).is<Event>();
  };

  ws.onclose = (event: CloseEvent) => {
    expectType(event).is<CloseEvent>();
    expectType(event.code).is<number>();
    expectType(event.reason).is<string>();
    expectType(event.wasClean).is<boolean>();
  };

  // Using event handler properties without typing the agument
  ws.onopen = event => {
    expectType(event).is<Event>();
  };

  ws.onmessage = event => {
    expectType(event.data).is<any>();

    if (typeof event.data === "string") {
      expectType(event.data).is<string>();
    } else if (event.data instanceof ArrayBuffer) {
      expectType(event.data).is<ArrayBuffer>();
    }
  };

  ws.onerror = event => {
    expectType(event).is<Event>();
  };

  ws.onclose = event => {
    expectType(event).is<CloseEvent>();
    expectType(event.code).is<number>();
    expectType(event.reason).is<string>();
    expectType(event.wasClean).is<boolean>();
  };
}

// WebSocket addEventListener test
{
  const ws = new WebSocket("wss://dev.local");

  // Event handler functions
  const handleOpen = (event: Event) => {
    expectType(event).is<Event>();
  };

  const handleMessage = (event: MessageEvent<string>) => {
    expectType(event.data).is<string>();
  };

  const handleError = (event: Event) => {
    expectType(event).is<Event>();
  };

  const handleClose = (event: CloseEvent) => {
    expectType(event).is<CloseEvent>();
    expectType(event.code).is<number>();
    expectType(event.reason).is<string>();
    expectType(event.wasClean).is<boolean>();
  };

  // Add event listeners
  ws.addEventListener("open", handleOpen);
  ws.addEventListener("message", handleMessage);
  ws.addEventListener("error", handleError);
  ws.addEventListener("close", handleClose);

  // Remove event listeners
  ws.removeEventListener("open", handleOpen);
  ws.removeEventListener("message", handleMessage);
  ws.removeEventListener("error", handleError);
  ws.removeEventListener("close", handleClose);
}

// WebSocket property access test
{
  const ws = new WebSocket("wss://dev.local");

  // Read various properties
  expectType(ws.readyState).is<0 | 2 | 1 | 3>();
  expectType(ws.bufferedAmount).is<number>();
  expectType(ws.url).is<string>();
  expectType(ws.protocol).is<string>();
  expectType(ws.extensions).is<string>();

  // Legacy URL property (deprecated but exists)
  expectType(ws.URL).is<string>();

  // Set binary type
  ws.binaryType = "arraybuffer";
  ws.binaryType = "nodebuffer";
}

// WebSocket send method test
{
  const ws = new WebSocket("wss://dev.local");

  // Send string data
  ws.send("Hello, server!");

  // Send ArrayBuffer
  const buffer = new ArrayBuffer(10);
  ws.send(buffer);

  // Send ArrayBufferView (Uint8Array)
  const uint8Array = new Uint8Array(buffer);
  ws.send(uint8Array);

  // --------------------------------------- //
  // `.send(blob)` is not supported yet
  // --------------------------------------- //
  // // Send Blob
  // const blob = new Blob(["Hello, server!"]);
  // ws.send(blob);
  // --------------------------------------- //
}

// WebSocket close method test
{
  const ws = new WebSocket("wss://dev.local");

  // Close without parameters
  ws.close();

  // Close with code
  ws.close(1000);

  // Close with code and reason
  ws.close(1001, "Going away");
}

// Bun-specific WebSocket extensions test
{
  const ws = new WebSocket("wss://dev.local");

  // Send ping frame with no data
  ws.ping();

  // Send ping frame with string data
  ws.ping("ping data");

  // Send ping frame with ArrayBuffer
  const pingBuffer = new ArrayBuffer(4);
  ws.ping(pingBuffer);

  // Send ping frame with ArrayBufferView
  const pingView = new Uint8Array(pingBuffer);
  ws.ping(pingView);

  // Send pong frame with no data
  ws.pong();

  // Send pong frame with string data
  ws.pong("pong data");

  // Send pong frame with ArrayBuffer
  const pongBuffer = new ArrayBuffer(4);
  ws.pong(pongBuffer);

  // Send pong frame with ArrayBufferView
  const pongView = new Uint8Array(pongBuffer);
  ws.pong(pongView);

  // Terminate the connection immediately
  ws.terminate();
}
