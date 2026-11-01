// `new WebSocket()` reads `new.target.prototype` for the prototype of the socket. The read can throw.
// It must throw before the constructor dials: the caller gets no socket, so nothing could close it.

import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";

describe("new WebSocket() with a new.target whose prototype cannot be read", () => {
  function unreadableNewTargets(): [newTarget: Function, error: string | typeof TypeError][] {
    const accessor = function () {}.bind(null);
    Object.defineProperty(accessor, "prototype", {
      get() {
        throw new Error("prototype getter");
      },
    });
    const trap = new Proxy(function () {}, {
      get(target, key, receiver) {
        if (key === "prototype") throw new Error("prototype trap");
        return Reflect.get(target, key, receiver);
      },
    });
    const { proxy: revoked, revoke } = Proxy.revocable(function () {}, {});
    revoke();
    return [
      [accessor, "prototype getter"],
      [trap, "prototype trap"],
      [revoked, TypeError],
    ];
  }

  it.each([
    ["url", (url: string) => [url]],
    ["url, protocols", (url: string) => [url, ["chat", "superchat"]]],
    ["url, protocol", (url: string) => [url, "chat"]],
    ["url, options", (url: string) => [url, { headers: { "x-test": "1" } }]],
  ] as const)("new WebSocket(%s) throws before it dials", async (_overload, args) => {
    // Counts every TCP connection, then refuses the handshake so that each client closes.
    let connections = 0;
    const server = createServer(socket => {
      connections++;
      socket.on("error", () => {});
      socket.once("data", () => socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n"));
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      for (const [newTarget, error] of unreadableNewTargets()) {
        expect(() => Reflect.construct(WebSocket, args(url), newTarget)).toThrow(error);
      }

      // A subclass has a prototype that can be read, so this one dials. The server accepts in
      // dial order: when it has refused this socket, it has counted every socket dialed before it.
      class Subclass extends WebSocket {}
      const last: WebSocket = Reflect.construct(Subclass, args(url));
      expect(Object.getPrototypeOf(last)).toBe(Subclass.prototype);
      last.onerror = () => {};
      await new Promise(resolve => (last.onclose = resolve));
      expect(connections).toBe(1);
    } finally {
      server.close();
    }
  });
});
