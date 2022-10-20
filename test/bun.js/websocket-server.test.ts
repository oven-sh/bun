import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import { gcTick } from "gc";

var port = 4321;
function getPort() {
  if (port > 4444) {
    port = 4321;
  }

  return port++;
}

describe("websocket server", () => {
  for (let method of ["publish", "publishText", "publishBinary"]) {
    describe(method, () => {
      it("in close() should work", async () => {
        var server = serve({
          port: getPort(),
          websocket: {
            open(ws) {
              ws.subscribe("all");
            },
            message(ws, msg) {},
            close(ws) {
              ws[method](
                "all",
                method === "publishBinary" ? Buffer.from("bye!") : "bye!"
              );
            },
          },
          fetch(req, server) {
            if (server.upgrade(req)) {
              return;
            }

            return new Response("success");
          },
        });

        try {
          const first = await new Promise((resolve2, reject2) => {
            var socket = new WebSocket(
              `ws://${server.hostname}:${server.port}`
            );
            socket.onopen = () => resolve2(socket);
          });

          const second = await new Promise((resolve2, reject2) => {
            var socket = new WebSocket(
              `ws://${server.hostname}:${server.port}`
            );
            socket.onmessage = (ev) => {
              var msg = ev.data;
              if (typeof msg !== "string") {
                msg = new TextDecoder().decode(msg);
              }
              if (msg === "bye!") {
                resolve2(socket);
              } else {
                reject2(msg);
              }
            };
            socket.onopen = () => {
              first.close();
            };
          });

          second.close();
        } catch (r) {
        } finally {
          server.stop();
        }
      });
    });
  }

  it("close inside open", async () => {
    var resolve;
    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {},
        message(ws, msg) {},
        close() {
          resolve();
        },
      },
      fetch(req, server) {
        if (
          server.upgrade(req, {
            data: "hello world",

            // check that headers works
            headers: {
              "x-a": "text/plain",
            },
          })
        ) {
          if (server.upgrade(req)) {
            throw new Error("should not upgrade twice");
          }
          return;
        }

        return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve_, reject) => {
      resolve = resolve_;
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.close();
      };
      websocket.onmessage = (e) => {};
      websocket.onerror = (e) => {};
    });
    server.stop();
  });

  it("headers error doesn't crash", async () => {
    var resolve, reject;
    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {},
        message(ws, msg) {},
        close() {
          resolve();
        },
      },
      error(err) {
        resolve();
      },
      fetch(req, server) {
        try {
          if (
            server.upgrade(req, {
              data: "hello world",

              headers: 1238,
            })
          ) {
            reject();
            return;
          }
        } catch (e) {
          resolve();
          return new Response("success");
        }

        reject();
        return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve_, reject) => {
      resolve = resolve_;
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => websocket.close();
      websocket.onmessage = (e) => {};
      websocket.onerror = (e) => {};
    });
    server.stop();
  });
  it("can do hello world", async () => {
    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {},
        message(ws, msg) {
          ws.send("hello world");
        },
      },
      fetch(req, server) {
        if (
          server.upgrade(req, {
            data: "hello world",

            // check that headers works
            headers: {
              "x-a": "text/plain",
            },
          })
        ) {
          if (server.upgrade(req)) {
            throw new Error("should not upgrade twice");
          }
          return;
        }

        return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.send("hello world");
      };
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
    server.stop();
  });

  it("fetch() allows a Response object to be returned for an upgraded ServerWebSocket", () => {
    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {},
        message(ws, msg) {
          ws.send("hello world");
        },
      },
      error(err) {
        console.error(err);
      },
      fetch(req, server) {
        if (
          server.upgrade(req, {
            data: "hello world",

            // check that headers works
            headers: {
              "x-a": "text/plain",
            },
          })
        ) {
          if (server.upgrade(req)) {
            throw new Error("should not upgrade twice");
          }
          return new Response("lol!", {
            status: 101,
          });
        }

        return new Response("noooooo hello world");
      },
    });

    return new Promise((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.send("hello world");
      };
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

  it("fetch() allows a Promise<Response> object to be returned for an upgraded ServerWebSocket", () => {
    var server = serve({
      port: getPort(),
      websocket: {
        async open(ws) {},
        async message(ws, msg) {
          await 1;
          ws.send("hello world");
        },
      },
      error(err) {
        console.error(err);
      },
      async fetch(req, server) {
        await 1;
        if (
          server.upgrade(req, {
            data: "hello world",

            // check that headers works
            headers: {
              "x-a": "text/plain",
            },
          })
        ) {
          if (server.upgrade(req)) {
            throw new Error("should not upgrade twice");
          }
          return new Response("lol!", {
            status: 101,
          });
        }

        return new Response("noooooo hello world");
      },
    });
    return new Promise((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.send("hello world");
      };
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
  it("binaryType works", async () => {
    var done = false;
    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {},
        message(ws, msg) {
          if (ws.binaryType === "uint8array") {
            expect(ws.binaryType).toBe("uint8array");
            ws.binaryType = "arraybuffer";
            expect(ws.binaryType).toBe("arraybuffer");
            expect(msg instanceof Uint8Array).toBe(true);
          } else {
            expect(ws.binaryType).toBe("arraybuffer");
            expect(msg instanceof ArrayBuffer).toBe(true);
            done = true;
          }

          ws.send("hello world");
        },
      },
      fetch(req, server) {
        if (server.upgrade(req, { data: "hello world" })) {
          if (server.upgrade(req)) {
            throw new Error("should not upgrade twice");
          }
          return;
        }

        return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve, reject) => {
      var counter = 0;
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.send(Buffer.from("hello world"));
      };
      websocket.onmessage = (e) => {
        try {
          expect(e.data).toBe("hello world");

          if (counter++ > 0) {
            server?.stop();
            websocket.close();
            resolve(done);
          }
          websocket.send(Buffer.from("oaksd"));
        } catch (r) {
          server?.stop();
          websocket.close();
          reject(r);
          return;
        } finally {
        }
      };
      websocket.onerror = (e) => {
        reject(e);
      };
    });
    server.stop();
  });

  it("does not upgrade for non-websocket connections", async () => {
    await new Promise(async (resolve, reject) => {
      var server = serve({
        port: getPort(),
        websocket: {
          open(ws) {
            ws.send("hello world");
          },
          message(ws, msg) {},
        },
        fetch(req, server) {
          if (server.upgrade(req)) {
            reject("should not upgrade");
          }

          return new Response("success");
        },
      });

      const response = await fetch(`http://${server.hostname}:${server.port}`);
      expect(await response.text()).toBe("success");
      resolve();
      server.stop();
    });
  });

  it("does not upgrade for non-websocket servers", async () => {
    await new Promise(async (resolve, reject) => {
      var server = serve({
        port: getPort(),

        fetch(req, server) {
          try {
            server.upgrade(req);
            reject("should not upgrade");
          } catch (e) {
            resolve();
          }

          return new Response("success");
        },
      });

      const response = await fetch(`http://${server.hostname}:${server.port}`);
      expect(await response.text()).toBe("success");
      resolve();
      server.stop();
    });
  });

  it("async can do hello world", async () => {
    var server = serve({
      port: getPort(),
      websocket: {
        async open(ws) {
          ws.send("hello world");
        },
        message(ws, msg) {},
      },
      async fetch(req, server) {
        await 1;
        if (server.upgrade(req)) return;

        return new Response("noooooo hello world");
      },
    });

    await new Promise((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);

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

  it("publishText()", async () => {
    await new Promise((resolve, reject) => {
      var server = serve({
        port: getPort(),
        websocket: {
          async open(ws) {
            // we don't care about the data
            // we just want to make sure the DOMJIT call doesn't crash
            for (let i = 0; i < 40_000; i++) ws.publishText("hello", "world");
            resolve();
          },
          message(ws, msg) {},
        },
        async fetch(req, server) {
          await 1;
          if (server.upgrade(req)) return;

          return new Response("noooooo hello world");
        },
      });

      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onmessage = () => {};
      websocket.onerror = () => {};
    });
  });

  it("publishBinary()", async () => {
    const bytes = Buffer.from("hello");
    await new Promise((resolve, reject) => {
      var server = serve({
        port: getPort(),
        websocket: {
          async open(ws) {
            // we don't care about the data
            // we just want to make sure the DOMJIT call doesn't crash
            for (let i = 0; i < 40_000; i++) ws.publishBinary("hello", bytes);
            resolve();
          },
          message(ws, msg) {},
        },
        async fetch(req, server) {
          await 1;
          if (server.upgrade(req)) return;

          return new Response("noooooo hello world");
        },
      });

      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onmessage = () => {};
      websocket.onerror = () => {};
    });
  });

  it("sendText()", async () => {
    await new Promise((resolve, reject) => {
      var server = serve({
        port: getPort(),
        websocket: {
          async open(ws) {
            // we don't care about the data
            // we just want to make sure the DOMJIT call doesn't crash
            for (let i = 0; i < 40_000; i++) ws.sendText("hello world", true);
            resolve();
          },
          message(ws, msg) {},
        },
        async fetch(req, server) {
          await 1;
          if (server.upgrade(req)) return;

          return new Response("noooooo hello world");
        },
      });

      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onmessage = () => {};
      websocket.onerror = () => {};
    });
  });

  it("sendBinary()", async () => {
    const bytes = Buffer.from("hello");
    await new Promise((resolve, reject) => {
      var server = serve({
        port: getPort(),
        websocket: {
          async open(ws) {
            // we don't care about the data
            // we just want to make sure the DOMJIT call doesn't crash
            for (let i = 0; i < 40_000; i++) ws.sendBinary(bytes, true);
            resolve();
          },
          message(ws, msg) {},
        },
        async fetch(req, server) {
          await 1;
          if (server.upgrade(req)) return;

          return new Response("noooooo hello world");
        },
      });

      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onmessage = () => {};
      websocket.onerror = () => {};
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
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);

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
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
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
          gcTick();
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
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
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

  // this test sends 100 messages to 10 connected clients via pubsub
  it("pub/sub", async () => {
    var ropey = "hello world".repeat(10);
    var sendQueue = [];
    for (var i = 0; i < 100; i++) {
      sendQueue.push(ropey + " " + i);
      gcTick();
    }
    var serverCounter = 0;
    var clientCount = 0;
    var server = serve({
      port: getPort(),
      websocket: {
        open(ws) {
          ws.subscribe("test");
          gcTick();
          if (!ws.isSubscribed("test")) {
            throw new Error("not subscribed");
          }
          ws.unsubscribe("test");
          if (ws.isSubscribed("test")) {
            throw new Error("subscribed");
          }
          ws.subscribe("test");
          clientCount++;
          if (clientCount === 10)
            setTimeout(() => ws.publish("test", "hello world"), 1);
        },
        message(ws, msg) {
          if (serverCounter < sendQueue.length)
            ws.publish("test", sendQueue[serverCounter++] + " ");
        },
      },
      fetch(req, server) {
        gcTick();

        if (
          server.upgrade(req, {
            data: { count: 0 },
          })
        )
          return;
        return new Response("noooooo hello world");
      },
    });

    const connections = new Array(10);
    const websockets = new Array(connections.length);
    var doneCounter = 0;
    await new Promise((done) => {
      for (var i = 0; i < connections.length; i++) {
        var j = i;
        var resolve, reject, resolveConnection, rejectConnection;
        connections[j] = new Promise((res, rej) => {
          resolveConnection = res;
          rejectConnection = rej;
        });
        websockets[j] = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        gcTick();
        const websocket = new WebSocket(
          `ws://${server.hostname}:${server.port}`
        );
        websocket.onerror = (e) => {
          reject(e);
        };
        websocket.onclose = () => {
          doneCounter++;
          if (doneCounter === connections.length) {
            done();
          }
        };
        var hasOpened = false;
        websocket.onopen = () => {
          if (!hasOpened) {
            hasOpened = true;
            resolve(websocket);
          }
        };

        let clientCounter = -1;
        var hasSentThisTick = false;

        websocket.onmessage = (e) => {
          gcTick();

          if (!hasOpened) {
            hasOpened = true;
            resolve(websocket);
          }

          if (e.data === "hello world") {
            clientCounter = 0;
            websocket.send("first");
            return;
          }

          try {
            expect(!!sendQueue.find((a) => a + " " === e.data)).toBe(true);

            if (!hasSentThisTick) {
              websocket.send("second");
              hasSentThisTick = true;
              queueMicrotask(() => {
                hasSentThisTick = false;
              });
            }

            gcTick();

            if (clientCounter++ === sendQueue.length - 1) {
              websocket.close();
              resolveConnection();
            }
          } catch (r) {
            console.error(r);
            server?.stop();
            websocket.close();
            rejectConnection(r);
            gcTick();
            return;
          } finally {
          }
        };
      }
    });
    server?.stop();
    expect(serverCounter).toBe(sendQueue.length);
  });
});
