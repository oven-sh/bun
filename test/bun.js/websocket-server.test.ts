import { file, gc, serve } from "bun";
import { afterEach, describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

var port = 4321;
function getPort() {
  if (port > 4444) {
    port = 4321;
  }

  return port++;
}

describe("websocket server", () => {
  it("can do hello world", async () => {
    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {
          ws.send("hello world");
        },
        message(ws, msg) {},
      },
      fetch(req, server) {
        if (server.upgrade(req)) return;

        return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve, reject) => {
      const websocket = new WebSocket(`ws://localhost:${server.port}`);

      websocket.onmessage = (e) => {
        try {
          expect(e.data).toBe("hello world");
          resolve();
        } catch (r) {
          reject(r);
          return;
        } finally {
          server?.stop();
          websocket.close();
        }
      };
      websocket.onerror = (e) => {
        reject(e);
      };
    });
  });

  it("can do hello world corked", async () => {
    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {
          ws.send("hello world");
        },
        message(ws, msg) {
          ws.cork(() => {
            ws.send("hello world");
          });
        },
      },
      fetch(req, server) {
        if (server.upgrade(req)) return;

        return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve, reject) => {
      const websocket = new WebSocket(`ws://localhost:${server.port}`);

      websocket.onmessage = (e) => {
        try {
          expect(e.data).toBe("hello world");
          resolve();
        } catch (r) {
          reject(r);
          return;
        } finally {
          server?.stop();
          websocket.close();
        }
      };
      websocket.onerror = (e) => {
        reject(e);
      };
    });
  });

  it("can do some back and forth", async () => {
    var dataCount = 0;
    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {},
        message(ws, msg) {
          if (msg === "first") {
            ws.send("first");
            return;
          }
          ws.send(`counter: ${dataCount++}`);
        },
      },
      fetch(req, server) {
        if (
          server.upgrade(req, {
            count: 0,
          })
        )
          return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve, reject) => {
      const websocket = new WebSocket(`ws://localhost:${server.port}`);
      websocket.onerror = (e) => {
        reject(e);
      };

      var counter = 0;
      websocket.onopen = () => websocket.send("first");
      websocket.onmessage = (e) => {
        try {
          switch (counter++) {
            case 0: {
              expect(e.data).toBe("first");
              websocket.send("where are the loops");
              break;
            }
            case 1: {
              expect(e.data).toBe("counter: 0");
              websocket.send("br0ther may i have some loops");
              break;
            }
            case 2: {
              expect(e.data).toBe("counter: 1");
              websocket.send("br0ther may i have some loops");
              break;
            }
            case 3: {
              expect(e.data).toBe("counter: 2");
              resolve();
              break;
            }
          }
        } catch (r) {
          reject(r);
          console.error(r);
          server?.stop();
          console.log("i am closing!");
          websocket.close();
          return;
        } finally {
        }
      };
    });
  });

  it("send rope strings", async () => {
    var ropey = "hello world".repeat(10);
    var sendQueue = [];
    for (var i = 0; i < 100; i++) {
      sendQueue.push(ropey + " " + i);
    }

    var serverCounter = 0;
    var clientCounter = 0;

    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {},
        message(ws, msg) {
          ws.send(sendQueue[serverCounter++] + " ");
        },
      },
      fetch(req, server) {
        if (
          server.upgrade(req, {
            data: { count: 0 },
          })
        )
          return;

        return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve, reject) => {
      const websocket = new WebSocket(`ws://localhost:${server.port}`);
      websocket.onerror = (e) => {
        reject(e);
      };

      var counter = 0;
      websocket.onopen = () => websocket.send("first");
      websocket.onmessage = (e) => {
        try {
          const expected = sendQueue[clientCounter++] + " ";
          expect(e.data).toBe(expected);
          websocket.send("next");
          if (clientCounter === sendQueue.length) {
            websocket.close();
            resolve();
          }
        } catch (r) {
          reject(r);
          console.error(r);
          server?.stop();
          websocket.close();
          return;
        } finally {
        }
      };
    });

    server?.stop();
  });
});
