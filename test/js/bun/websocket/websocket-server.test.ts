import { describe, expect, it } from "bun:test";
import { gcTick } from "harness";
import { serve, ServerWebSocket } from "bun";

describe("websocket server", () => {
  it("remoteAddress works", done => {
    let server = Bun.serve({
      websocket: {
        message() {},
        open(ws) {
          try {
            expect(ws.remoteAddress).toBe("127.0.0.1");
            done();
          } catch (e) {
            done(e);
          }
        },
        close() {},
      },
      fetch(req, server) {
        if (!server.upgrade(req)) {
          return new Response(null, { status: 404 });
        }
      },
      port: 0,
    });

    let z = new WebSocket(`ws://${server.hostname}:${server.port}`);
    z.addEventListener("open", () => {
      setTimeout(() => z.close(), 0);
    });
    z.addEventListener("close", () => {
      server.stop();
    });
  });
  it("can do publish()", async done => {
    var server = serve({
      port: 0,
      websocket: {
        open(ws) {
          ws.subscribe("all");
        },
        message(ws, msg) {},
        close(ws) {},
      },
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("success");
      },
    });

    await new Promise<void>((resolve2, reject2) => {
      var socket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      var clientCounter = 0;

      socket.onmessage = e => {
        expect(e.data).toBe("hello");
        resolve2();
      };
      socket.onopen = () => {
        queueMicrotask(() => {
          server.publish("all", "hello");
        });
      };
    });
    server.stop(true);
    done();
  });

  it("can do publish() with publishToSelf: false", async done => {
    var server = serve({
      port: 0,
      websocket: {
        open(ws) {
          ws.subscribe("all");
          ws.publish("all", "hey");
          server.publish("all", "hello");
        },
        message(ws, msg) {
          if (new TextDecoder().decode(msg as Uint8Array) !== "hello") {
            done(new Error("unexpected message"));
          }
        },
        close(ws) {},
        publishToSelf: false,
      },
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("success");
      },
    });

    await new Promise<void>((resolve2, reject2) => {
      var socket = new WebSocket(`ws://${server.hostname}:${server.port}`);

      socket.onmessage = e => {
        expect(e.data).toBe("hello");
        resolve2();
      };
    });
    server.stop(true);
    done();
  });

  for (let method of ["publish", "publishText", "publishBinary"] as const) {
    describe(method, () => {
      it("in close() should work", async () => {
        var count = 0;
        var server = serve({
          port: 0,
          websocket: {
            open(ws) {
              ws.subscribe("all");
            },
            message(ws, msg) {},
            close(ws) {
              (ws[method] as any)("all", method === "publishBinary" ? Buffer.from("bye!") : "bye!");
              count++;

              if (count >= 2) {
                server.stop(true);
              }
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
          const first = await new Promise<WebSocket>((resolve2, reject2) => {
            var socket = new WebSocket(`ws://${server.hostname}:${server.port}`);
            socket.onopen = () => resolve2(socket);
          });

          await new Promise<WebSocket>((resolve2, reject2) => {
            var socket = new WebSocket(`ws://${server.hostname}:${server.port}`);
            socket.onopen = () => {
              queueMicrotask(() => first.close());
            };
            socket.onmessage = ev => {
              var msg = ev.data;
              if (typeof msg !== "string") {
                msg = new TextDecoder().decode(msg);
              }

              if (msg === "bye!") {
                socket.close(0);
                resolve2(socket);
              } else {
                reject2(msg);
              }
            };
          });
        } finally {
          server.stop(true);
        }
      });
    });
  }

  it("close inside open", async () => {
    var resolve: () => void;
    console.trace("here");
    var server = serve({
      port: 0,
      websocket: {
        open(ws) {},
        message(ws, msg) {},
        close() {
          resolve();
          server.stop(true);
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

    await new Promise<void>((resolve_, reject) => {
      resolve = resolve_;
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.close();
      };
      websocket.onmessage = e => {};
      websocket.onerror = e => {};
    });
  });

  it("headers error doesn't crash", async () => {
    await new Promise<void>((resolve, reject) => {
      const server = serve({
        port: 0,
        websocket: {
          open(ws) {
            ws.close();
          },
          message(ws, msg) {},
          close() {
            resolve();
            server.stop(true);
          },
        },
        error(err) {
          resolve();
          server.stop(true);
        },
        fetch(req, server) {
          expect(() => {
            if (
              server.upgrade(req, {
                data: "hello world",
                headers: 1238 as any,
              })
            ) {
              reject(new Error("should not upgrade"));
              return new Response("should not upgrade");
            }
          }).toThrow("upgrade options.headers must be a Headers or an object");
          resolve();
          return new Response("success");
        },
      });

      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => websocket.close();
      websocket.onmessage = e => {};
      websocket.onerror = e => {};
    });
  });
  it("can do hello world", async () => {
    const server = serve({
      port: 0,
      websocket: {
        open(ws) {
          server.stop();
        },
        message(ws, msg) {
          ws.send("hello world");
        },
      },
      fetch(req, server) {
        server.stop();
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

    await new Promise<void>((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.send("hello world");
      };
      websocket.onmessage = e => {
        try {
          expect(e.data).toBe("hello world");
          resolve();
        } catch (r) {
          reject(r);
        } finally {
          websocket.close();
        }
      };
      websocket.onerror = e => {
        reject(e);
      };
    });
  });

  it("fetch() allows a Response object to be returned for an upgraded ServerWebSocket", () => {
    const server = serve({
      port: 0,
      websocket: {
        open(ws) {
          server.stop();
        },
        message(ws, msg) {
          ws.send("hello world");
        },
      },
      error(err) {
        console.error(err);
      },
      fetch(req, server) {
        server.stop();
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

    return new Promise<void>((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.send("hello world");
      };
      websocket.onmessage = e => {
        try {
          expect(e.data).toBe("hello world");
          resolve();
        } catch (r) {
          reject(r);
        } finally {
          websocket.close();
        }
      };
      websocket.onerror = e => {
        reject(e);
      };
    });
  });

  it("fetch() allows a Promise<Response> object to be returned for an upgraded ServerWebSocket", () => {
    const server = serve({
      port: 0,
      websocket: {
        async open(ws) {
          server.stop();
        },
        async message(ws, msg) {
          await 1;
          ws.send("hello world");
        },
      },
      error(err) {
        console.error(err);
      },
      async fetch(req, server) {
        server.stop();
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
    return new Promise<void>((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.send("hello world");
      };
      websocket.onmessage = e => {
        try {
          expect(e.data).toBe("hello world");
          resolve();
        } catch (r) {
          reject(r);
        } finally {
          websocket.close();
        }
      };
      websocket.onerror = e => {
        reject(e);
      };
    });
  });
  it("binaryType works", async () => {
    var done = false;
    const server = serve({
      port: 0,
      websocket: {
        open(ws) {
          server.stop();
        },
        message(ws, msg) {
          // The first message is supposed to be "uint8array"
          // Then after uint8array, we switch it to "nodebuffer"
          // Then after nodebuffer, we switch it to "arraybuffer"
          // and then we're done
          switch (ws.binaryType) {
            case "uint8array": {
              for (let badType of [
                123,
                NaN,
                Symbol("uint8array"),
                "uint16array",
                "uint32array",
                "float32array",
                "float64array",
                "garbage",
              ]) {
                expect(() => {
                  /* @ts-ignore */
                  ws.binaryType = badType;
                }).toThrow();
              }
              expect(ws.binaryType).toBe("uint8array");
              ws.binaryType = "nodebuffer";
              expect(ws.binaryType).toBe("nodebuffer");
              expect(msg instanceof Uint8Array).toBe(true);
              expect(Buffer.isBuffer(msg)).toBe(false);
              break;
            }

            case "nodebuffer": {
              expect(ws.binaryType).toBe("nodebuffer");
              ws.binaryType = "arraybuffer";
              expect(ws.binaryType).toBe("arraybuffer");
              expect(msg instanceof Uint8Array).toBe(true);
              expect(Buffer.isBuffer(msg)).toBe(true);
              break;
            }

            case "arraybuffer": {
              expect(ws.binaryType).toBe("arraybuffer");
              expect(msg instanceof ArrayBuffer).toBe(true);
              done = true;
              break;
            }

            default: {
              throw new Error("unknown binaryType");
            }
          }

          ws.send("hello world");
        },
      },
      fetch(req, server) {
        server.stop();
        if (server.upgrade(req, { data: "hello world" })) {
          if (server.upgrade(req)) {
            throw new Error("should not upgrade twice");
          }
          return;
        }

        return new Response("noooooo hello world");
      },
    });

    const isDone = await new Promise<boolean>((resolve, reject) => {
      var counter = 0;
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onopen = () => {
        websocket.send(Buffer.from("hello world"));
      };
      websocket.onmessage = e => {
        try {
          expect(e.data).toBe("hello world");

          if (counter++ > 2) {
            websocket.close();
            resolve(done);
          }
          websocket.send(Buffer.from("oaksd"));
        } catch (r) {
          websocket.close();
          reject(r);
        }
      };
      websocket.onerror = e => {
        reject(e);
      };
    });
    expect(isDone).toBe(true);
  });

  it("does not upgrade for non-websocket connections", async () => {
    await new Promise<void>(async (resolve, reject) => {
      var server = serve({
        port: 0,
        websocket: {
          open(ws) {
            ws.send("hello world");
          },
          message(ws, msg) {},
        },
        fetch(req, server) {
          if (server.upgrade(req)) {
            reject(new Error("should not upgrade"));
          }

          return new Response("success");
        },
      });

      const response = await fetch(`http://${server.hostname}:${server.port}`);
      expect(await response.text()).toBe("success");
      resolve();
      server.stop(true);
    });
  });

  it("does not upgrade for non-websocket servers", async () => {
    await new Promise<void>(async (resolve, reject) => {
      const server = serve({
        port: 0,
        fetch(req, server) {
          server.stop();
          expect(() => {
            server.upgrade(req);
          }).toThrow('To enable websocket support, set the "websocket" object in Bun.serve({})');
          return new Response("success");
        },
      });

      const response = await fetch(`http://${server.hostname}:${server.port}`);
      expect(await response.text()).toBe("success");
      resolve();
    });
  });

  it("async can do hello world", async () => {
    const server = serve({
      port: 0,
      websocket: {
        async open(ws) {
          server.stop(true);
          ws.send("hello world");
        },
        message(ws, msg) {},
      },
      async fetch(req, server) {
        server.stop();
        await 1;
        if (server.upgrade(req)) return;

        return new Response("noooooo hello world");
      },
    });

    await new Promise<void>((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);

      websocket.onmessage = e => {
        try {
          expect(e.data).toBe("hello world");
          resolve();
        } catch (r) {
          reject(r);
        } finally {
          websocket.close();
        }
      };
      websocket.onerror = e => {
        reject(e);
      };
    });
  });

  it("publishText()", async () => {
    await new Promise<void>((resolve, reject) => {
      var websocket: WebSocket;
      var server = serve({
        port: 0,
        websocket: {
          async open(ws) {
            // we don't care about the data
            // we just want to make sure the DOMJIT call doesn't crash
            for (let i = 0; i < 40_000; i++) ws.publishText("hello", "world");
            websocket.close();
            server.stop(true);
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

      websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
    });
  });

  it("publishBinary()", async () => {
    const bytes = Buffer.from("hello");

    await new Promise<void>((resolve, reject) => {
      var websocket: WebSocket;
      var server = serve({
        port: 0,
        websocket: {
          async open(ws) {
            // we don't care about the data
            // we just want to make sure the DOMJIT call doesn't crash
            for (let i = 0; i < 40_000; i++) ws.publishBinary("hello", bytes);
            websocket.close();
            server.stop(true);
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

      websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
    });
  });

  it("sendText()", async () => {
    await new Promise<void>((resolve, reject) => {
      var websocket: WebSocket;
      var server = serve({
        port: 0,
        websocket: {
          async open(ws) {
            // we don't care about the data
            // we just want to make sure the DOMJIT call doesn't crash
            for (let i = 0; i < 40_000; i++) ws.sendText("hello world", true);
            resolve();
            websocket.close();
            server.stop(true);
          },
          message(ws, msg) {},
        },
        async fetch(req, server) {
          await 1;
          if (server.upgrade(req)) return;

          return new Response("noooooo hello world");
        },
      });
      websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
    });
  });

  it("sendBinary()", async () => {
    const bytes = Buffer.from("hello");
    await new Promise<void>((resolve, reject) => {
      var websocket: WebSocket;
      var server = serve({
        port: 0,
        websocket: {
          async open(ws) {
            // we don't care about the data
            // we just want to make sure the DOMJIT call doesn't crash
            for (let i = 0; i < 40_000; i++) ws.sendBinary(bytes, true);
            websocket.close();
            server.stop(true);
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

      websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
    });
  });

  it("can do hello world corked", async () => {
    const server = serve({
      port: 0,
      websocket: {
        open(ws) {
          server.stop();
          ws.send("hello world");
        },
        message(ws, msg) {
          ws.cork(() => {
            ws.send("hello world");
          });
        },
      },
      fetch(req, server) {
        server.stop();
        if (server.upgrade(req)) return;
        return new Response("noooooo hello world");
      },
    });

    await new Promise<void>((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);

      websocket.onmessage = e => {
        try {
          expect(e.data).toBe("hello world");
          resolve();
        } catch (r) {
          reject(r);
        } finally {
          websocket.close();
        }
      };
      websocket.onerror = e => {
        reject(e);
      };
    });
    server.stop(true);
  });

  it("can do some back and forth", async () => {
    var dataCount = 0;
    const server = serve({
      port: 0,
      websocket: {
        open(ws) {
          server.stop();
        },
        message(ws, msg) {
          if (msg === "first") {
            ws.send("first");
            return;
          }
          ws.send(`counter: ${dataCount++}`);
        },
      },
      fetch(req, server) {
        server.stop();
        if (
          server.upgrade(req, {
            data: { count: 0 },
          })
        )
          return new Response("noooooo hello world");
      },
    });

    await new Promise<void>((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onerror = e => {
        reject(e);
      };

      var counter = 0;
      websocket.onopen = () => websocket.send("first");
      websocket.onmessage = e => {
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
          websocket.close();
        }
      };
    });
    server.stop(true);
  });

  it("send rope strings", async () => {
    var ropey = "hello world".repeat(10);
    var sendQueue: any[] = [];
    for (var i = 0; i < 100; i++) {
      sendQueue.push(ropey + " " + i);
    }

    var serverCounter = 0;
    var clientCounter = 0;

    const server = serve({
      port: 0,
      websocket: {
        open(ws) {
          server.stop();
        },
        message(ws, msg) {
          ws.send(sendQueue[serverCounter++] + " ");
          gcTick();
        },
      },
      fetch(req, server) {
        server.stop();
        if (
          server.upgrade(req, {
            data: { count: 0 },
          })
        )
          return;

        return new Response("noooooo hello world");
      },
    });

    await new Promise<void>((resolve, reject) => {
      const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
      websocket.onerror = e => {
        reject(e);
      };

      var counter = 0;
      websocket.onopen = () => websocket.send("first");
      websocket.onmessage = e => {
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
          websocket.close();
        }
      };
    });
    server.stop(true);
  });

  // this test sends 100 messages to 10 connected clients via pubsub
  it("pub/sub", async () => {
    var ropey = "hello world".repeat(10);
    var sendQueue: any[] = [];
    for (var i = 0; i < 100; i++) {
      sendQueue.push(ropey + " " + i);
      gcTick();
    }
    var serverCounter = 0;
    var clientCount = 0;
    const server = serve({
      port: 0,
      websocket: {
        open(ws) {
          server.stop();
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
          if (clientCount === 10) setTimeout(() => ws.publish("test", "hello world"), 1);
        },
        message(ws, msg) {
          if (serverCounter < sendQueue.length) ws.publish("test", sendQueue[serverCounter++] + " ");
        },
      },
      fetch(req) {
        gcTick();
        server.stop();
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
    await new Promise<void>(done => {
      for (var i = 0; i < connections.length; i++) {
        var j = i;
        var resolve: (_?: unknown) => void,
          reject: (_?: unknown) => void,
          resolveConnection: (_?: unknown) => void,
          rejectConnection: (_?: unknown) => void;
        connections[j] = new Promise((res, rej) => {
          resolveConnection = res;
          rejectConnection = rej;
        });
        websockets[j] = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        gcTick();
        const websocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
        websocket.onerror = e => {
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

        websocket.onmessage = e => {
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
            expect(!!sendQueue.find(a => a + " " === e.data)).toBe(true);

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
            websocket.close();
            rejectConnection(r);
            gcTick();
          }
        };
      }
    });
    expect(serverCounter).toBe(sendQueue.length);
    server.stop(true);
  });
  it("can close with reason and code #2631", done => {
    let timeout: any;
    let server = Bun.serve({
      websocket: {
        message(ws) {
          ws.close(2000, "test");
        },
        open(ws) {
          try {
            expect(ws.remoteAddress).toBe("127.0.0.1");
          } catch (e) {
            clearTimeout(timeout);
            done(e);
          }
        },
        close(ws, code, reason) {
          try {
            expect(code).toBe(2000);
            expect(reason).toBe("test");
            clearTimeout(timeout);
            done();
          } catch (e) {
            clearTimeout(timeout);
            done(e);
          }
        },
      },
      fetch(req, server) {
        if (!server.upgrade(req)) {
          return new Response(null, { status: 404 });
        }
      },
      port: 0,
    });

    let z = new WebSocket(`ws://${server.hostname}:${server.port}`);
    z.addEventListener("open", () => {
      z.send("test");
    });
    z.addEventListener("close", () => {
      server.stop();
    });

    timeout = setTimeout(() => {
      done(new Error("Did not close in time"));
      server.stop(true);
    }, 1000);
  });

  it("can close with code and without reason #2631", done => {
    let timeout: any;
    let server = Bun.serve({
      websocket: {
        message(ws) {
          ws.close(2000);
        },
        open(ws) {
          try {
            expect(ws.remoteAddress).toBe("127.0.0.1");
          } catch (e) {
            done(e);
            clearTimeout(timeout);
          }
        },
        close(ws, code, reason) {
          clearTimeout(timeout);

          try {
            expect(code).toBe(2000);
            expect(reason).toBe("");
            done();
          } catch (e) {
            done(e);
          }
        },
      },
      fetch(req, server) {
        if (!server.upgrade(req)) {
          return new Response(null, { status: 404 });
        }
      },
      port: 0,
    });

    let z = new WebSocket(`ws://${server.hostname}:${server.port}`);
    z.addEventListener("open", () => {
      z.send("test");
    });
    z.addEventListener("close", () => {
      server.stop();
    });

    timeout = setTimeout(() => {
      done(new Error("Did not close in time"));
      server.stop(true);
    }, 1000);
  });
  it("can close without reason or code #2631", done => {
    let timeout: any;
    let server = Bun.serve({
      websocket: {
        message(ws) {
          ws.close();
        },
        open(ws) {
          try {
            expect(ws.remoteAddress).toBe("127.0.0.1");
          } catch (e) {
            clearTimeout(timeout);
            done(e);
          }
        },
        close(ws, code, reason) {
          clearTimeout(timeout);
          try {
            expect(code).toBe(1006);
            expect(reason).toBe("");
            done();
          } catch (e) {
            done(e);
          }
        },
      },
      fetch(req, server) {
        if (!server.upgrade(req)) {
          return new Response(null, { status: 404 });
        }
      },
      port: 0,
    });

    let z = new WebSocket(`ws://${server.hostname}:${server.port}`);
    z.addEventListener("open", () => {
      z.send("test");
    });
    z.addEventListener("close", () => {
      server.stop();
    });

    timeout = setTimeout(() => {
      done(new Error("Did not close in time"));
      server.stop(true);
    }, 1000);
  });
});
