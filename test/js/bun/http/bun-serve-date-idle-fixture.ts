// For bun-serve-date.test.ts. Holds one idle socket, and nothing else that could turn the event
// loop, then prints how many times the loop turned meanwhile.
//
//   bun bun-serve-date-idle-fixture.ts <kind> <idle ms> [port]
//
// net, tls, https-agent: a client socket to the server that the test runs on [port].
// serve-keep-alive: a Bun.serve connection. The port is printed first, and the test is the
// client.
import { getEventLoopStats } from "bun:internal-for-testing";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const [kind, idleMs, port] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];

/** Resolves, once the socket is open and quiet, to a check that it still is. */
function open(): Promise<() => boolean | undefined> {
  const { promise, resolve, reject } = Promise.withResolvers<() => boolean | undefined>();
  switch (kind) {
    case "net":
    case "tls": {
      const socket =
        kind === "tls"
          ? tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false })
          : net.connect({ host: "127.0.0.1", port });
      socket.on("error", reject);
      // The server greets with one byte. Once it is here, the handshake and everything a TLS
      // server sends after it (session tickets) are behind us.
      socket.once("data", () => resolve(() => !socket.destroyed && socket.readyState === "open"));
      break;
    }
    case "https-agent": {
      const agent = new https.Agent({ keepAlive: true });
      // The response is over and the socket is parked in agent.freeSockets.
      agent.once("free", socket => {
        resolve(() => !socket.destroyed && Object.values(agent.freeSockets).flat().includes(socket));
      });
      https.get({ host: "127.0.0.1", port, agent, rejectUnauthorized: false }, res => res.resume()).on("error", reject);
      break;
    }
    case "serve-keep-alive": {
      const server = Bun.serve({
        port: 0,
        // The connection has to outlive the idle time.
        idleTimeout: 0,
        fetch() {
          // Only the client can tell whether a keep-alive connection is still open.
          resolve(() => undefined);
          return new Response("ok");
        },
      });
      console.log(server.port);
      break;
    }
  }
  return promise;
}

const stillOpen = await open();
const before = getEventLoopStats().iteration;
setTimeout(() => {
  console.log(JSON.stringify({ open: stillOpen(), iterations: getEventLoopStats().iteration - before }));
  // The server stays up for the test to check the connection. The test ends it.
  if (kind !== "serve-keep-alive") process.exit(0);
}, idleMs);
