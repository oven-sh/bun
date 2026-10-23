// Fixture: the kernel refuses a TLS socket that the low-priority handshake queue hands back to the poll.
//
// 16 clients call shutdown() when their last handshake flight left. A relay holds the server's last flight until the
// FIN of every client arrived, then delivers it, with a FIN, to all of them in one tick. The loop reads 5 handshaking
// sockets per iteration and switches the reads of the others off. Both directions of such a socket are down, and
// epoll reports that whether the socket reads or not, so the dispatcher takes the socket out of epoll. The queue
// registers it again, which is an EPOLL_CTL_ADD. The fault makes the first one fail.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { tls as certs } from "harness";
import { once } from "node:events";
import net from "node:net";
import { createServer } from "node:tls";

const CONNECTIONS = 16;

let done = false;
function fail(error: unknown) {
  // The teardown of the relay resets connections.
  if (done) return;
  console.error(error);
  process.exit(1);
}

const server = createServer({ ...certs, maxVersion: "TLSv1.2" }, socket => {
  socket.on("error", fail);
  socket.end("last words");
});
server.on("tlsClientError", fail);
await once(server.listen(0, "127.0.0.1"), "listening");

const deliveries: (() => void)[] = [];
const relayed: net.Socket[] = [];
const serversEnded = Promise.withResolvers<void>();
const clientsEnded = Promise.withResolvers<void>();
let serverFins = 0;
let clientFins = 0;
const relay = net.createServer({ allowHalfOpen: true }, fromClient => {
  const toServer = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
  relayed.push(fromClient, toServer);
  // What the server sends after the client's second flight is its last flight.
  let sawServerHello = false;
  let holding = false;
  const held: Buffer[] = [];
  fromClient.on("data", data => {
    holding = sawServerHello;
    toServer.write(data);
  });
  toServer.on("data", data => {
    sawServerHello = true;
    if (holding) held.push(data);
    else fromClient.write(data);
  });
  toServer.on("end", () => ++serverFins === CONNECTIONS && serversEnded.resolve());
  fromClient.on("end", () => ++clientFins === CONNECTIONS && clientsEnded.resolve());
  fromClient.on("error", fail);
  toServer.on("error", fail);
  deliveries.push(() => fromClient.end(Buffer.concat(held)));
});
await once(relay.listen(0, "127.0.0.1"), "listening");

type Observed = { events: string[]; closed: PromiseWithResolvers<void> };
const clients: Bun.Socket<Observed>[] = [];
for (let i = 0; i < CONNECTIONS; i++) {
  clients.push(
    await Bun.connect<Observed>({
      hostname: "127.0.0.1",
      port: (relay.address() as net.AddressInfo).port,
      tls: { rejectUnauthorized: false },
      data: { events: [], closed: Promise.withResolvers<void>() },
      socket: {
        open() {},
        handshake(socket) {
          socket.data.events.push("handshake");
        },
        data(socket, data) {
          socket.data.events.push(`data ${data}`);
        },
        close(socket, error) {
          socket.data.events.push(error ? `close ${(error as NodeJS.ErrnoException).code}` : "close");
          socket.data.closed.resolve();
        },
        error(_socket, error) {
          fail(error);
        },
      },
    }),
  );
}
await serversEnded.promise;
for (const client of clients) client.shutdown();
await clientsEnded.promise;

fault.set({ syscall: "poll_start", action: "errno", errno: "ENOMEM", repeat: 1 });
for (const deliver of deliveries) deliver();
await Promise.all(clients.map(client => client.data.closed.promise));
fault.clear();

const outcomes: Record<string, number> = {};
for (const { data } of clients) {
  const outcome = data.events.join(", ");
  outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
}
console.log(JSON.stringify({ outcomes }));

done = true;
for (const socket of relayed) socket.destroy();
relay.close();
server.close();
