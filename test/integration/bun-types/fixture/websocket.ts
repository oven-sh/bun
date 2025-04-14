export class TestWebSocketClient {
  #ws: WebSocket;
  #dataWs: WebSocket;

  constructor() {
    // Test constructor with string URL and protocol string array
    this.#ws = new WebSocket("wss://dev.local", ["proto1", "proto2"]);

    // Test constructor with URL object and protocols
    this.#dataWs = new WebSocket(new URL("wss://dev.local"), {
      protocols: ["proto1", "proto2"],
    });

    // Access static properties
    const states = {
      CONNECTING: WebSocket.CONNECTING, // 0
      OPEN: WebSocket.OPEN, // 1
      CLOSING: WebSocket.CLOSING, // 2
      CLOSED: WebSocket.CLOSED, // 3
    };

    // Test event handlers
    this.#ws.onopen = (event: Event) => {
      console.log("Connection opened");
    };

    this.#ws.onmessage = (event: MessageEvent) => {
      // Test data types when receiving messages
      if (typeof event.data === "string") {
        console.log("Received string:", event.data);
      } else if (event.data instanceof ArrayBuffer) {
        console.log("Received ArrayBuffer");
      }
    };

    this.#ws.onerror = (event: Event) => {
      console.log("Error occurred");
    };

    this.#ws.onclose = (event: CloseEvent) => {
      console.log(`Connection closed: ${event.code} ${event.reason} ${event.wasClean}`);
    };

    // Test property access
    const readyState = this.#ws.readyState;
    const bufferedAmount = this.#ws.bufferedAmount;
    const url = this.#ws.url;
    const protocol = this.#ws.protocol;
    const extensions = this.#ws.extensions;

    // Test binary type setting
    this.#ws.binaryType = "arraybuffer";
    this.#ws.binaryType = "blob";

    // The URL property is deprecated but exists in the type definitions
    const deprecatedUrl = this.#ws.url; // Using url instead of URL to avoid linter error

    // Test addEventListener methods
    this.#ws.addEventListener("open", this.handleOpen);
    this.#ws.addEventListener("message", this.handleMessage);
    this.#ws.addEventListener("error", this.handleError);
    this.#ws.addEventListener("close", this.handleClose);
  }

  handleOpen(event: Event): void {
    console.log("Connection opened via event listener");
  }

  handleMessage(event: MessageEvent): void {
    console.log("Message received via event listener");
  }

  handleError(event: Event): void {
    console.log("Error occurred via event listener");
  }

  handleClose(event: CloseEvent): void {
    console.log("Connection closed via event listener");
  }

  sendData(): void {
    // Test sending different data types
    this.#ws.send("Hello, server!");

    // Send ArrayBuffer
    const buffer = new ArrayBuffer(10);
    this.#ws.send(buffer);

    // Send ArrayBufferView (Uint8Array)
    const uint8Array = new Uint8Array(buffer);
    this.#ws.send(uint8Array);
  }

  testRemoveEventListeners(): void {
    // Test removeEventListener methods
    this.#ws.removeEventListener("open", this.handleOpen);
    this.#ws.removeEventListener("message", this.handleMessage);
    this.#ws.removeEventListener("error", this.handleError);
    this.#ws.removeEventListener("close", this.handleClose);
  }

  close(): void {
    // Test close method with different parameters
    if (this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.close();
    }

    this.#dataWs.close(1000);
    this.#dataWs.close(1001, "Going away");
  }

  testPingPong(): void {
    // Test ping and pong methods
    this.#ws.ping();
    this.#ws.ping("ping data");

    const pingBuffer = new ArrayBuffer(4);
    this.#ws.ping(pingBuffer);

    const pingView = new Uint8Array(pingBuffer);
    this.#ws.ping(pingView);

    this.#ws.pong();
    this.#ws.pong("pong data");

    const pongBuffer = new ArrayBuffer(4);
    this.#ws.pong(pongBuffer);

    const pongView = new Uint8Array(pongBuffer);
    this.#ws.pong(pongView);
  }

  terminate(): void {
    // Test terminate method
    this.#ws.terminate();
  }
}
