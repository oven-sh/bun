// Bun.ModuleGraph: the 'close' of a node:net socket belongs to whoever opened the socket. The handle of the
// socket queues it in the context the handle was made in, so a graph that only destroys a socket does not own it.
import { describe, expect, test } from "bun:test";
import { tls } from "harness";
import http from "node:http";
import net from "node:net";
import nodeTls from "node:tls";

const closed = (socket: net.Socket) => new Promise<void>(resolve => socket.once("close", () => resolve()));
const connected = (socket: net.Socket) =>
  new Promise<net.Socket>((resolve, reject) => socket.once("connect", () => resolve(socket)).once("error", reject));
const listening = (server: net.Server) =>
  new Promise<number>((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
const sink = (socket: net.Socket) => void socket.on("error", () => {}).resume();

/** Runs `destroy` in the context of a graph that is disposed before anything it scheduled can run. */
function inDisposedGraph(destroy: () => void) {
  const graph = new Bun.ModuleGraph();
  graph.run(destroy);
  graph.dispose();
}

/** Resolves after a 1ms host timer fired `turns` times: long enough for a 'close' that was queued to have run. */
async function hostTimerTurns(turns = 5): Promise<void> {
  let fired = 0;
  const { promise, resolve } = Promise.withResolvers<void>();
  const interval = setInterval(() => {
    if (++fired >= turns) resolve();
  }, 1);
  try {
    await promise;
  } finally {
    clearInterval(interval);
  }
}

describe.concurrent("ModuleGraph: the 'close' of a node:net socket is its opener's", () => {
  test("a graph that destroys a socket of the host's and is disposed does not take the 'close' with it", async () => {
    const server = net.createServer(sink);
    const secureServer = nodeTls.createServer({ key: tls.key, cert: tls.cert }, sink);
    const [port, securePort] = await Promise.all([listening(server), listening(secureServer)]);
    try {
      await Promise.all([
        (async () => {
          const socket = await connected(net.connect(port, "127.0.0.1"));
          inDisposedGraph(() => socket.destroy());
          await closed(socket);
        })(),
        (async () => {
          const socket = await connected(net.connect(port, "127.0.0.1"));
          inDisposedGraph(() => socket.resetAndDestroy());
          await closed(socket);
        })(),
        (async () => {
          const accepted = Promise.withResolvers<net.Socket>();
          const accepting = net.createServer(accepted.resolve);
          const client = net.connect(await listening(accepting), "127.0.0.1").on("error", () => {});
          try {
            const socket = await accepted.promise;
            inDisposedGraph(() => socket.destroy());
            await closed(socket);
          } finally {
            client.destroy();
            accepting.close();
          }
        })(),
        (async () => {
          // A net.Socket and the TLS socket over it share a handle: both close when the first is destroyed.
          const raw = await connected(net.connect(securePort, "127.0.0.1"));
          const secure = nodeTls.connect({ socket: raw, rejectUnauthorized: false }).on("error", () => {});
          await new Promise<void>(resolve => secure.once("secureConnect", () => resolve()));
          const bothClosed = Promise.all([closed(raw), closed(secure)]);
          inDisposedGraph(() => raw.destroy());
          await bothClosed;
        })(),
      ]);
    } finally {
      server.close();
      secureServer.close();
    }
  });

  test("a socket of a graph's that the host destroys once the graph is disposed tells the graph nothing", async () => {
    const server = net.createServer(sink);
    const port = await listening(server);
    try {
      const heard: string[] = [];
      const graph = new Bun.ModuleGraph();
      const socket = await graph.run(() =>
        connected(net.connect(port, "127.0.0.1").on("close", () => heard.push("close"))),
      );
      graph.dispose();
      socket.destroy();
      await hostTimerTurns();
      expect(heard).toEqual([]);
    } finally {
      server.close();
    }
  });

  test("an http.Agent of the host's goes on after a graph destroyed a request that went through it", async () => {
    const server = http.createServer((request, response) => {
      if (request.url !== "/hang") response.end("ok");
    });
    const port = await listening(server);
    const agent = new http.Agent({ maxSockets: 1 });
    try {
      const hanging = http.get({ port, host: "127.0.0.1", path: "/hang", agent }).on("error", () => {});
      await new Promise<void>(resolve => hanging.once("socket", socket => socket.once("connect", () => resolve())));

      inDisposedGraph(() => hanging.destroy());

      // The agent has one socket: the next request waits for the 'close' of the one that was destroyed.
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      http
        .get({ port, host: "127.0.0.1", path: "/", agent }, response => {
          response.setEncoding("utf8").once("data", resolve);
        })
        .on("error", reject);
      expect(await promise).toBe("ok");
    } finally {
      agent.destroy();
      server.closeAllConnections();
      server.close();
    }
  });
});
