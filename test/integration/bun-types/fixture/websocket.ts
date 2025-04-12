export class TestWebSocketClient {
  #ws: WebSocket;

  constructor() {
    this.#ws = new WebSocket("wss://dev.local", {
      headers: {
        cookie: "test=test",
      },
    });
  }

  close() {
    if (this.#ws != null) this.#ws.close();
  }
}
