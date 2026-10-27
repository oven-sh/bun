// node:net completes a write that waited for its socket in the async context of the write, and a Bun.ModuleGraph
// context rides the async context. A write on a socket that another script opened still completes as that script:
// the rest of the socket's life must not go with a graph that only wrote and is disposed since.
import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

const storage = new AsyncLocalStorage<string>();
// More than the kernel takes in one call while the peer does not read, so the write waits for the socket.
const big = Buffer.alloc(8 * 1024 * 1024);

const contextOf = (graph: Bun.ModuleGraph) =>
  Bun.ModuleGraph.current === graph ? "the graph" : Bun.ModuleGraph.current ? "another graph" : "the host";

// The events of `socket` as they come, with the script each listener ran as.
function eventsOf(socket: net.Socket, graph: Bun.ModuleGraph) {
  const events: string[] = [];
  for (const event of ["drain", "finish", "close"]) {
    socket.on(event, () => events.push(`'${event}' as ${contextOf(graph)}`));
  }
  return events;
}

// A connected pair. The accepted socket does not read until it is resumed.
async function connectedPair() {
  const server = net.createServer(socket => void socket.pause());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const accepted = once(server, "connection") as Promise<[net.Socket]>;
  const client = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
  const [, [serverSock]] = await Promise.all([once(client, "connect"), accepted]);
  serverSock.on("error", () => {});
  return {
    client,
    serverSock,
    [Symbol.dispose]() {
      client.destroy();
      serverSock.destroy();
      server.close();
    },
  };
}

// Windows takes a write of any size at once, so no write waits for its socket there.
describe.skipIf(isWindows)("a write that waited for its socket, and Bun.ModuleGraph", () => {
  test("on a socket of the graph's own: in the async context of the write", async () => {
    using graph = new Bun.ModuleGraph();
    using p = await graph.run(() => storage.run("opened", connectedPair));
    const { promise, resolve } = Promise.withResolvers<{ store: string | undefined; context: string }>();
    graph.run(() =>
      storage.run("write", () =>
        p.client.write(big, () => resolve({ store: storage.getStore(), context: contextOf(graph) })),
      ),
    );
    expect(p.client.writableLength).toBeGreaterThan(0);
    p.serverSock.resume();
    expect(await promise).toEqual({ store: "write", context: "the graph" });
  });

  test("on a socket of the host's: 'drain' and the callback of a disposed graph's write run as the host", async () => {
    using p = await connectedPair();
    const graph = new Bun.ModuleGraph();
    const events = eventsOf(p.client, graph);
    const drained = once(p.client, "drain");
    graph.run(() => p.client.write(big, () => events.push("write callback as " + contextOf(graph))));
    expect(p.client.writableLength).toBeGreaterThan(0);
    graph.dispose();
    p.serverSock.resume();
    await drained;
    expect(events).toEqual(["'drain' as the host", "write callback as the host"]);
  });

  test("on a socket of the host's: the end(chunk) of a disposed graph still finishes and closes the socket", async () => {
    // The peer's FIN comes first, so the end of the write side is what closes the socket.
    const server = net.createServer({ allowHalfOpen: true }, socket => {
      socket.on("error", () => {});
      socket.end();
      socket.resume();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = net.connect({
      port: (server.address() as net.AddressInfo).port,
      host: "127.0.0.1",
      allowHalfOpen: true,
    });
    try {
      client.resume();
      await once(client, "end");
      const graph = new Bun.ModuleGraph();
      const events = eventsOf(client, graph);
      const closed = once(client, "close");
      graph.run(() => client.end(big, () => events.push("end callback as " + contextOf(graph))));
      expect(client.writableLength).toBeGreaterThan(0);
      graph.dispose();
      await closed;
      expect(events).toEqual(["end callback as the host", "'finish' as the host", "'close' as the host"]);
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("on a socket of the host's: a disposed graph's write that the host's destroy() fails", async () => {
    using p = await connectedPair();
    const graph = new Bun.ModuleGraph();
    const events = eventsOf(p.client, graph);
    const closed = once(p.client, "close");
    graph.run(() =>
      p.client.write(big, err =>
        events.push(`write callback (${(err as NodeJS.ErrnoException)?.code}) as ${contextOf(graph)}`),
      ),
    );
    expect(p.client.writableLength).toBeGreaterThan(0);
    graph.dispose();
    p.client.destroy();
    await closed;
    expect(events).toEqual(["write callback (ERR_SOCKET_CLOSED) as the host", "'close' as the host"]);
  });

  // Speaks HTTP by hand on each connection: it answers the first request of the first connection and then does what
  // `onUpload` says with the connection, and it answers every request of a later connection.
  async function originOf(onUpload: (socket: net.Socket) => void) {
    let connections = 0;
    const origin = net.createServer({ allowHalfOpen: true }, socket => {
      const first = ++connections === 1;
      let chunks = 0;
      socket.on("error", () => {});
      socket.on("data", chunk => {
        if (!first) {
          if (chunk.includes("\r\n\r\n")) {
            socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
          }
        } else if (++chunks === 1) {
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok");
          onUpload(socket);
        }
      });
    });
    origin.listen(0, "127.0.0.1");
    await once(origin, "listening");
    const port = (origin.address() as net.AddressInfo).port;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    return {
      agent,
      port,
      connections: () => connections,
      // A request of the host's: its status code.
      get(path: string) {
        const { promise, resolve, reject } = Promise.withResolvers<number | undefined>();
        http
          .get({ agent, port, host: "127.0.0.1", path }, response => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
          })
          .on("error", reject);
        return promise;
      },
      [Symbol.dispose]() {
        agent.destroy();
        origin.close();
      },
    };
  }

  test("on a connection of the host's Agent: the Agent serves its next request after the graph is disposed", async () => {
    const upload = Promise.withResolvers<net.Socket>();
    using origin = await originOf(socket =>
      // It stops reading at the upload.
      socket.once("data", () => {
        socket.pause();
        upload.resolve(socket);
      }),
    );
    const pooled = once(origin.agent, "free");
    const first = await origin.get("/first");
    await pooled;

    // The graph's upload goes out on the connection the host's request opened, and waits on it.
    const graph = new Bun.ModuleGraph();
    graph.run(() => {
      const request = http.request({
        agent: origin.agent,
        port: origin.port,
        host: "127.0.0.1",
        method: "POST",
        path: "/upload",
        headers: { "content-length": big.length },
      });
      request.on("error", () => {});
      request.end(big);
    });
    const peer = await upload.promise;
    graph.dispose();

    // The origin refuses the upload and closes. The Agent has one connection: the next request needs a new one.
    peer.end("HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    peer.resume();
    expect({ first, next: await origin.get("/next"), connections: origin.connections() }).toEqual({
      first: 200,
      next: 200,
      connections: 2,
    });
  });

  // The socket is the host's, so its 'drain' does not carry the graph's write. The request enters its own context
  // for its 'drain': what the graph's listener starts is the graph's, and is stopped with it.
  test("on a connection of the host's Agent: 'drain' of the graph's request runs as the graph", async () => {
    let peer!: net.Socket;
    using origin = await originOf(socket => {
      peer = socket;
    });
    const pooled = once(origin.agent, "free");
    await origin.get("/first");
    await pooled;

    using graph = new Bun.ModuleGraph();
    const drained = Promise.withResolvers<{ waited: boolean; store: string | undefined; context: string }>();
    let request!: http.ClientRequest;
    peer.pause();
    graph.run(() =>
      storage.run("request", () => {
        request = http.request({
          agent: origin.agent,
          port: origin.port,
          host: "127.0.0.1",
          method: "POST",
          path: "/upload",
          headers: { "content-length": 2 * big.length },
        });
        request.on("error", drained.reject);
        // A turn of the loop after 'socket', so that the socket is what makes the write wait.
        request.once("socket", () =>
          setImmediate(() => {
            storage.run("write", () => request.write(big));
            const waited = request.writableLength > 0;
            request.once("drain", () =>
              drained.resolve({ waited, store: storage.getStore(), context: contextOf(graph) }),
            );
            peer.resume();
          }),
        );
      }),
    );
    try {
      expect(await drained.promise).toEqual({ waited: true, store: "request", context: "the graph" });
    } finally {
      request.destroy();
    }
  });

  test("on an 'upgrade' socket of the host's: 'drain' and the callback of a disposed graph's write run as the host", async () => {
    const graph = new Bun.ModuleGraph();
    const seen = Promise.withResolvers<{ waited: boolean; events: string[] }>();
    let client!: net.Socket;
    const server = http.createServer();
    server.on("upgrade", (_request, socket) => {
      const events: string[] = [];
      let waited = false;
      socket.on("error", seen.reject);
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n");
      socket.once("drain", () => events.push("'drain' as " + contextOf(graph)));
      graph.run(() =>
        socket.write(big, () => {
          events.push("write callback as " + contextOf(graph));
          seen.resolve({ waited, events });
        }),
      );
      waited = socket.writableLength > 0;
      graph.dispose();
      client.resume();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    try {
      client.on("error", seen.reject);
      client.pause();
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n");
      expect(await seen.promise).toEqual({
        waited: true,
        events: ["'drain' as the host", "write callback as the host"],
      });
    } finally {
      client.destroy();
      server.close();
    }
  });

  // The connection is the host's, so its 'drain' does not carry the graph's write. The response enters the context
  // its write waited in: what the graph's listener starts is the graph's.
  test("on a connection the host hands to an HTTP server: the graph's response write completes as the graph", async () => {
    using graph = new Bun.ModuleGraph();
    const seen = Promise.withResolvers<{ waited: boolean; events: string[] }>();
    let client!: net.Socket;
    const server = http.createServer((_request, response) => {
      const events: string[] = [];
      let waited = false;
      response.setHeader("Content-Length", big.length);
      response.once("drain", () => events.push("'drain' as " + contextOf(graph)));
      graph.run(() =>
        response.write(big, () => {
          events.push("write callback as " + contextOf(graph));
          response.end();
          seen.resolve({ waited, events });
        }),
      );
      setImmediate(() => {
        waited = response.writableLength > 0;
        client.resume();
      });
    });
    const acceptor = net.createServer(socket => void server.emit("connection", socket));
    acceptor.listen(0, "127.0.0.1");
    await once(acceptor, "listening");
    client = net.connect((acceptor.address() as net.AddressInfo).port, "127.0.0.1");
    try {
      client.on("error", seen.reject);
      client.pause();
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      expect(await seen.promise).toEqual({
        waited: true,
        events: ["'drain' as the graph", "write callback as the graph"],
      });
    } finally {
      client.destroy();
      acceptor.close();
    }
  });
});
