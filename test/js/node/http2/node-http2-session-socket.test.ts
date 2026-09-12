/**
 * Http2Session#socket once the session has detached from its socket.
 *
 * Each session caches the Proxy that `session.socket` returns. After destroy() every trap of that
 * Proxy throws ERR_HTTP2_SOCKET_UNBOUND, including the getPrototypeOf trap that `instanceof` calls.
 * Node returns undefined from the getter from then on, so the getter must not return the cached Proxy.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-session-socket.test.ts
 *   node --test test/js/node/http2/node-http2-session-socket.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { test } from "node:test";

type Side = { session: http2.Http2Session; socketBefore: unknown };

function isSocket(value: unknown): boolean | string {
  try {
    return value instanceof net.Socket;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code ?? String(e);
  }
}

function probe({ session, socketBefore }: Side) {
  return {
    before: typeof socketBefore,
    after: typeof session.socket,
    afterIsSocket: isSocket(session.socket),
    // A reference taken before destroy() still throws, as in node.
    beforeIsSocket: isSocket(socketBefore),
  };
}

test("session.socket is undefined after the session is destroyed", async () => {
  const server = http2.createServer();
  let client: http2.ClientHttp2Session | undefined;
  try {
    const serverSide = Promise.withResolvers<Side>();
    const serverSideClosed = Promise.withResolvers<void>();
    server.on("session", session => {
      session.on("error", () => {});
      session.on("close", () => serverSideClosed.resolve());
      // Read the getter while the socket is attached, so the session caches its Proxy.
      serverSide.resolve({ session, socketBefore: session.socket });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    await once(client, "connect");
    const sides = { client: { session: client, socketBefore: client.socket }, server: await serverSide.promise };

    const clientSideClosed = once(client, "close");
    client.destroy();
    await Promise.all([clientSideClosed, serverSideClosed.promise]);

    const detached = {
      before: "object",
      after: "undefined",
      afterIsSocket: false,
      beforeIsSocket: "ERR_HTTP2_SOCKET_UNBOUND",
    };
    assert.deepStrictEqual(
      { client: probe(sides.client), server: probe(sides.server) },
      { client: detached, server: detached },
    );
  } finally {
    client?.destroy();
    server.close();
  }
});
