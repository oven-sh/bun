import { describe, expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import tls from "node:tls";

const protocols = ["http", "https"] as const;
type Protocol = (typeof protocols)[number];

function connect(protocol: Protocol, port: number) {
  return protocol === "https"
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect(port, "127.0.0.1");
}

// The bytes that follow a request head in the same read are the `head` of the 'connect' and 'upgrade' events. No
// other request has a use for them.
describe("the bytes behind a request head", () => {
  const get = (path: string) => `GET ${path} HTTP/1.1\r\nHost: example.com\r\n\r\n`;
  const post = (fields = "") => `POST URL HTTP/1.1\r\nHost: example.com\r\nContent-Length: 5\r\n${fields}\r\n`;
  const upgrade = "Connection: Upgrade\r\nUpgrade: test\r\n";

  // The request ("URL" is its path), the bytes behind it in the same write, and whether a listener can get them.
  const dispatches: Record<string, { request: string; behind: string; handOff: boolean; splitAt?: number }> = {
    "POST and its body": { request: post(), behind: "hello", handOff: false },
    "POST and its body, head in two reads": { request: post(), behind: "hello", handOff: false, splitAt: 20 },
    "GET and a pipelined request": { request: get("URL"), behind: get("/next"), handOff: false },
    // nginx sends this field with every request under `proxy_set_header Connection "upgrade"`.
    "GET and a pipelined request, `upgrade` in Connection and no Upgrade field": {
      request: `GET URL HTTP/1.1\r\nHost: example.com\r\nConnection: upgrade\r\n\r\n`,
      behind: get("/next"),
      handOff: false,
    },
    "GET and a pipelined request, Upgrade field and no `upgrade` in Connection": {
      request: `GET URL HTTP/1.1\r\nHost: example.com\r\nUpgrade: test\r\n\r\n`,
      behind: get("/next"),
      handOff: false,
    },
    // `curl --http2` sends these fields with an upload over cleartext. 'upgrade' gets no head from a request with a body.
    "POST and its body, Upgrade request": {
      request: post(
        "Connection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\nHTTP2-Settings: AAMAAABkAAQAoAAAAAIAAAAA\r\n",
      ),
      behind: "hello",
      handOff: false,
    },
    "Upgrade request": {
      request: `GET URL HTTP/1.1\r\nHost: example.com\r\n${upgrade}\r\n`,
      behind: get("/next"),
      handOff: true,
    },
    "CONNECT": { request: "CONNECT URL HTTP/1.1\r\nHost: example.com\r\n\r\n", behind: "tunneled", handOff: true },
  };

  test.each(protocols)("%s: reach JavaScript only for a request that can hand them to a listener", async protocol => {
    // For each request, the bytes of the typed array that the native dispatcher passed to JavaScript, or null.
    const passed = new Map<string, string | null>();
    const onDispatch = new Map<string, () => void>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: protocol === "https" ? tlsCert : undefined,
      // @ts-expect-error internal option used by node:http's Server
      onNodeHTTPRequest(bunServer: unknown, url: string, ...rest: unknown[]) {
        const head = rest.find(argument => ArrayBuffer.isView(argument)) as Buffer | undefined;
        passed.set(url, head ? head.toString("latin1") : null);
        onDispatch.get(url)?.();
      },
    });

    // Resolves when the server has dispatched the request that `write` sends. No request gets a response here.
    async function dispatch(url: string, write: (client: net.Socket) => void | Promise<void>) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      onDispatch.set(url, resolve);
      const client = connect(protocol, server.port!);
      try {
        client.on("error", reject);
        client.on("close", () => reject(new Error(`the connection closed before ${url} was dispatched`)));
        // A write before this event waits for it, and then two writes can leave as one.
        await Promise.race([once(client, protocol === "https" ? "secureConnect" : "connect"), promise]);
        await write(client);
        await promise;
      } finally {
        client.destroy();
      }
    }

    const names = Object.keys(dispatches);
    for (const name of names) {
      const { request, behind, splitAt } = dispatches[name];
      const url = `/${names.indexOf(name)}`;
      const bytes = request.replace("URL", url) + behind;
      await dispatch(url, async client => {
        if (splitAt === undefined) return void client.write(bytes);
        client.write(bytes.slice(0, splitAt));
        // A request that was written later is dispatched: the server has read the first part.
        await dispatch(`${url}/barrier`, barrier => void barrier.write(get(`${url}/barrier`)));
        client.write(bytes.slice(splitAt));
      });
    }

    expect(Object.fromEntries(names.map(name => [name, passed.get(`/${names.indexOf(name)}`)]))).toEqual(
      Object.fromEntries(names.map(name => [name, dispatches[name].handOff ? dispatches[name].behind : null])),
    );
  });

  const handOffs = [
    ["connect", "example.com:80", "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n"],
    ["connect", "/path", "CONNECT /path HTTP/1.1\r\nHost: example.com\r\n\r\n"],
    ["upgrade", "/plain", `GET /plain HTTP/1.1\r\nHost: example.com\r\n${upgrade}\r\n`],
    [
      "upgrade",
      "/websocket",
      "GET /websocket HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    ],
  ] as const;
  const everyHandOff = protocols.flatMap(protocol => handOffs.map(handOff => [protocol, ...handOff] as const));

  async function listen(protocol: Protocol, options: http.ServerOptions = {}) {
    const server = protocol === "https" ? https.createServer({ ...tlsCert, ...options }) : http.createServer(options);
    await once(server.listen(0, "127.0.0.1"), "listening");
    return server;
  }

  // The second write has the length of the first, so the read of it overwrites the receive buffer of the first. The
  // listener reads `head` after that read.
  test.each(everyHandOff)("%s: are the head of '%s' for %s", async (protocol, event, url, request) => {
    const second = Buffer.alloc(request.length + "tunneled".length, "-").toString();
    const { promise, resolve, reject } = Promise.withResolvers<object>();
    await using server = await listen(protocol);
    server.on(event, (req, socket, head) => {
      let received = "";
      socket.on("error", reject);
      socket.on("data", chunk => {
        received += chunk.toString("latin1");
        if (received.length < second.length) return;
        resolve({ url: req.url, head: head.toString("latin1"), second: received === second });
        socket.end();
      });
      socket.write("HTTP/1.1 200 OK\r\n\r\n");
    });
    server.on("request", req => reject(new Error(`'request' for ${req.method} ${req.url}`)));
    server.on("clientError", reject);

    const client = connect(protocol, (server.address() as AddressInfo).port);
    try {
      client.on("error", reject);
      client.on("close", () => reject(new Error(`the connection closed before '${event}' got the second read`)));
      client.once("data", () => client.write(second));
      client.write(request + "tunneled");
      expect(await promise).toEqual({ url, head: "tunneled", second: true });
    } finally {
      client.destroy();
    }
  });

  // The constructor of a request runs inside the dispatch, before the event.
  test.each(everyHandOff)(
    "%s: are the head of '%s' for %s when user code destroyed the socket first",
    async (protocol, event, url, request) => {
      class DestroysSocket extends http.IncomingMessage {
        constructor(...args: ConstructorParameters<typeof http.IncomingMessage>) {
          super(...args);
          this.socket.destroy();
        }
      }
      const { promise, resolve, reject } = Promise.withResolvers<object>();
      await using server = await listen(protocol, { IncomingMessage: DestroysSocket });
      server.on(event, (req, socket, head) =>
        resolve({ url: req.url, head: head.toString("latin1"), destroyed: socket.destroyed }),
      );
      server.on("request", req => reject(new Error(`'request' for ${req.method} ${req.url}`)));

      const client = connect(protocol, (server.address() as AddressInfo).port);
      try {
        client.on("error", () => {});
        client.on("close", () => reject(new Error(`the connection closed and '${event}' did not fire`)));
        client.write(request + "tunneled");
        expect(await promise).toEqual({ url, head: "tunneled", destroyed: true });
      } finally {
        client.destroy();
      }
    },
  );
});
