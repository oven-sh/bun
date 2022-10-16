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
      fetch(req) {
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
        accept(ws) {
          return { count: 0 };
        },
        open(ws) {
          ws.send("first");
        },
        message(ws, msg) {
          ws.send(`counter: ${dataCount++}`);
        },
      },
      fetch(req) {
        return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve, reject) => {
      const websocket = new WebSocket(`ws://localhost:${server.port}`);

      var counter = 0;
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
      websocket.onerror = (e) => {
        reject(e);
      };
    });
  });
});
