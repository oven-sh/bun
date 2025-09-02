import { describe, expect, it, mock } from "bun:test";
import { normalizeBunSnapshot } from "harness";
import net from "node:net";
import crypto from "node:crypto";

describe("WebSocket subprotocol", () => {
  it("client should NOT close connection when server responds with NO Sec-WebSocket-Protocol header (its valid)", async () => {
    const { promise: openPromise, resolve: resolveOpen } = Promise.withResolvers();
    const { promise: clientOpenPromise, resolve: resolveClientOpen } = Promise.withResolvers();

    await using server = net.createServer();
    let port: number;

    await new Promise<void>(resolve => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    server.on("connection", socket => {
      let requestData = "";

      socket.on("data", data => {
        requestData += data.toString();

        if (requestData.includes("\r\n\r\n")) {
          const lines = requestData.split("\r\n");
          let websocketKey = "";

          for (const line of lines) {
            if (line.startsWith("Sec-WebSocket-Key:")) {
              websocketKey = line.split(":")[1].trim();
              break;
            }
          }

          const acceptKey = crypto
            .createHash("sha1")
            .update(websocketKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");

          const response = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${acceptKey}`,
            "\r\n",
          ].join("\r\n");

          socket.write(response);
          resolveOpen();
        }
      });
    });

    const ws = new WebSocket(`ws://localhost:${port}`, ["chat", "echo"]);
    ws.onopen = () => {
      resolveClientOpen();
    };

    await Promise.all([openPromise, clientOpenPromise]);

    expect(ws.protocol).toBe("");
    ws.terminate();
  });

  it("client should close connection when server responds with empty Sec-WebSocket-Protocol header (its invalid)", async () => {
    const { promise: openPromise, resolve: resolveOpen } = Promise.withResolvers();
    const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers();
    const { promise: clientOpenPromise, resolve: resolveClientOpen } = Promise.withResolvers();
    const { promise: clientClosePromise, resolve: resolveClientClose } = Promise.withResolvers();

    await using server = net.createServer();
    let port: number;

    await new Promise<void>(resolve => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    // Use node:net so that we can send an empty websocket header
    // Bun.serve() doesn't support this right now.
    server.on("connection", socket => {
      let requestData = "";

      socket.on("data", data => {
        requestData += data.toString();

        if (requestData.includes("\r\n\r\n")) {
          const lines = requestData.split("\r\n");
          let websocketKey = "";

          for (const line of lines) {
            if (line.startsWith("Sec-WebSocket-Key:")) {
              websocketKey = line.split(":")[1].trim();
              break;
            }
          }

          const acceptKey = crypto
            .createHash("sha1")
            .update(websocketKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");

          const response = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${acceptKey}`,
            "Sec-WebSocket-Protocol: ",
            "\r\n",
          ].join("\r\n");

          socket.write(response);
          resolveOpen();
          console.log("open");

          clientOpenPromise.then(() => {
            // Send close frame (opcode 8)
            const closeFrame = Buffer.from([0x88, 0x00]);
            socket.write(closeFrame);
            console.log("close");
            resolveClose();
            socket.end();
          });
        }
      });
    });

    const cleanup = () => {
      server.close();
    };

    const url = `ws://localhost:${port}`;
    const ws = new WebSocket(`ws://localhost:${port}`, ["chat", "echo"]);
    const onopenMock = mock(() => {});
    ws.onopen = onopenMock;

    ws.onclose = close => {
      // Also: test for [Circular] bug with CloseEvent not occurring.
      expect(normalizeBunSnapshot(Bun.inspect(close)).replaceAll(url, "<url>")).toMatchInlineSnapshot(`
        "CloseEvent {
          isTrusted: true,
          wasClean: true,
          code: 1002,
          reason: "Mismatch client protocol",
          type: "close",
          target: WebSocket {
            URL: "<url>/",
            url: "<url>/",
            readyState: 3,
            bufferedAmount: 0,
            onopen: [class Function extends Function],
            onmessage: null,
            onerror: null,
            onclose: [Function],
            protocol: "",
            extensions: "",
            binaryType: "nodebuffer",
            send: [Function: send],
            close: [Function: close],
            ping: [Function: ping],
            pong: [Function: pong],
            terminate: [Function: terminate],
            CONNECTING: 0,
            OPEN: 1,
            CLOSING: 2,
            CLOSED: 3,
            addEventListener: [Function: addEventListener],
            removeEventListener: [Function: removeEventListener],
            dispatchEvent: [Function: dispatchEvent],
          },
          currentTarget: WebSocket {
            URL: "<url>/",
            url: "<url>/",
            readyState: 3,
            bufferedAmount: 0,
            onopen: [class Function extends Function],
            onmessage: null,
            onerror: null,
            onclose: [Function],
            protocol: "",
            extensions: "",
            binaryType: "nodebuffer",
            send: [Function: send],
            close: [Function: close],
            ping: [Function: ping],
            pong: [Function: pong],
            terminate: [Function: terminate],
            CONNECTING: 0,
            OPEN: 1,
            CLOSING: 2,
            CLOSED: 3,
            addEventListener: [Function: addEventListener],
            removeEventListener: [Function: removeEventListener],
            dispatchEvent: [Function: dispatchEvent],
          },
          eventPhase: 2,
          cancelBubble: false,
          bubbles: false,
          cancelable: false,
          defaultPrevented: false,
          composed: false,
          timeStamp: 0,
          srcElement: WebSocket {
            URL: "<url>/",
            url: "<url>/",
            readyState: 3,
            bufferedAmount: 0,
            onopen: [class Function extends Function],
            onmessage: null,
            onerror: null,
            onclose: [Function],
            protocol: "",
            extensions: "",
            binaryType: "nodebuffer",
            send: [Function: send],
            close: [Function: close],
            ping: [Function: ping],
            pong: [Function: pong],
            terminate: [Function: terminate],
            CONNECTING: 0,
            OPEN: 1,
            CLOSING: 2,
            CLOSED: 3,
            addEventListener: [Function: addEventListener],
            removeEventListener: [Function: removeEventListener],
            dispatchEvent: [Function: dispatchEvent],
          },
          returnValue: true,
          composedPath: [Function: composedPath],
          stopPropagation: [Function: stopPropagation],
          stopImmediatePropagation: [Function: stopImmediatePropagation],
          preventDefault: [Function: preventDefault],
          initEvent: [Function: initEvent],
          NONE: 0,
          CAPTURING_PHASE: 1,
          AT_TARGET: 2,
          BUBBLING_PHASE: 3,
        }"
      `);

      resolveClientClose();
    };
    await clientClosePromise;

    expect(ws.protocol).toBe("");
    expect(onopenMock).not.toHaveBeenCalled();
  });

  it("should set protocol property to chosen subprotocol from multiple options", async () => {
    const { promise: openPromise, resolve: resolveOpen } = Promise.withResolvers();
    const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers();
    const { promise: clientOpenPromise, resolve: resolveClientOpen } = Promise.withResolvers();
    const { promise: clientClosePromise, resolve: resolveClientClose } = Promise.withResolvers();
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        const upgradeHeaders = {
          "Sec-WebSocket-Protocol": "echo",
        };
        if (server.upgrade(req, { headers: upgradeHeaders })) {
          return;
        }
        return new Response("not upgraded");
      },
      websocket: {
        async open(ws) {
          resolveOpen();
          await clientOpenPromise;

          ws.close();
        },
        close(ws) {
          resolveClose();
        },
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`, ["chat", "echo", "binary"]);
    ws.onopen = () => {
      resolveClientOpen();
    };
    ws.onclose = () => {
      resolveClientClose();
    };
    await Promise.all([openPromise, clientOpenPromise]);
    await Promise.all([closePromise, clientClosePromise]);

    expect(ws.protocol).toBe("echo");
  });

  it("client should error when server responds with mismatched protocol", async () => {
    const { promise: clientClosePromise, resolve: resolveClientClose } = Promise.withResolvers();
    const { promise: serverClosePromise, resolve: resolveServerClose } = Promise.withResolvers();
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        const upgradeHeaders = {
          "Sec-WebSocket-Protocol": "unknown-protocol",
        };
        if (server.upgrade(req, { headers: upgradeHeaders })) {
          return;
        }
        return new Response("not upgraded");
      },
      websocket: {
        open(ws) {
          // This can be called.
        },
        close(ws) {
          resolveServerClose();
        },
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`, ["chat", "echo"]);

    const close = mock(e => {
      // Also: test for [Circular] bug with CloseEvent not occurring.
      expect(normalizeBunSnapshot(Bun.inspect(e)).replaceAll(`ws://localhost:${server.port}`, `<url>`))
        .toMatchInlineSnapshot(`
        "CloseEvent {
          isTrusted: true,
          wasClean: true,
          code: 1002,
          reason: "Mismatch client protocol",
          type: "close",
          target: WebSocket {
            URL: "<url>/",
            url: "<url>/",
            readyState: 3,
            bufferedAmount: 0,
            onopen: null,
            onmessage: null,
            onerror: null,
            onclose: null,
            protocol: "",
            extensions: "",
            binaryType: "nodebuffer",
            send: [Function: send],
            close: [Function: close],
            ping: [Function: ping],
            pong: [Function: pong],
            terminate: [Function: terminate],
            CONNECTING: 0,
            OPEN: 1,
            CLOSING: 2,
            CLOSED: 3,
            addEventListener: [Function: addEventListener],
            removeEventListener: [Function: removeEventListener],
            dispatchEvent: [Function: dispatchEvent],
          },
          currentTarget: WebSocket {
            URL: "<url>/",
            url: "<url>/",
            readyState: 3,
            bufferedAmount: 0,
            onopen: null,
            onmessage: null,
            onerror: null,
            onclose: null,
            protocol: "",
            extensions: "",
            binaryType: "nodebuffer",
            send: [Function: send],
            close: [Function: close],
            ping: [Function: ping],
            pong: [Function: pong],
            terminate: [Function: terminate],
            CONNECTING: 0,
            OPEN: 1,
            CLOSING: 2,
            CLOSED: 3,
            addEventListener: [Function: addEventListener],
            removeEventListener: [Function: removeEventListener],
            dispatchEvent: [Function: dispatchEvent],
          },
          eventPhase: 2,
          cancelBubble: false,
          bubbles: false,
          cancelable: false,
          defaultPrevented: false,
          composed: false,
          timeStamp: 0,
          srcElement: WebSocket {
            URL: "<url>/",
            url: "<url>/",
            readyState: 3,
            bufferedAmount: 0,
            onopen: null,
            onmessage: null,
            onerror: null,
            onclose: null,
            protocol: "",
            extensions: "",
            binaryType: "nodebuffer",
            send: [Function: send],
            close: [Function: close],
            ping: [Function: ping],
            pong: [Function: pong],
            terminate: [Function: terminate],
            CONNECTING: 0,
            OPEN: 1,
            CLOSING: 2,
            CLOSED: 3,
            addEventListener: [Function: addEventListener],
            removeEventListener: [Function: removeEventListener],
            dispatchEvent: [Function: dispatchEvent],
          },
          returnValue: true,
          composedPath: [Function: composedPath],
          stopPropagation: [Function: stopPropagation],
          stopImmediatePropagation: [Function: stopImmediatePropagation],
          preventDefault: [Function: preventDefault],
          initEvent: [Function: initEvent],
          NONE: 0,
          CAPTURING_PHASE: 1,
          AT_TARGET: 2,
          BUBBLING_PHASE: 3,
        }"
      `);

      resolveClientClose();
    });

    ws.addEventListener("close", close);

    await Promise.all([clientClosePromise, serverClosePromise]);

    expect(ws.protocol).toBe("");
    expect(close).toHaveBeenCalled();
  });
});
