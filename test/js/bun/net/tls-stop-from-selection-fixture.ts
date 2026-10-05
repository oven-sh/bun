// listener.stop(true) called from alpnCallback or serverName.
//
// Both hooks run inside the SSL read that processes the ClientHello, so the
// accepted socket's SSL call is still on the stack when stop(true) closes every
// connection. That close waits until the SSL call returns, and the socket stays
// in the group until then. stop(true) must return without it, and the socket
// must close when the callback returns.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "node:tls";

const hook = process.argv[2];
const fixtures = join(import.meta.dir, "../../node/tls/fixtures");
const events: string[] = [];
const serverClosed = Promise.withResolvers<void>();

const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: {
    key: readFileSync(join(fixtures, "agent1-key.pem")),
    cert: readFileSync(join(fixtures, "agent1-cert.pem")),
  },
  socket: {
    [hook]() {
      server.stop(true);
      events.push("returned");
      return hook === "alpnCallback" ? "x/1" : undefined;
    },
    handshake(_socket, success) {
      events.push(`handshake:${success}`);
    },
    data() {},
    close() {
      events.push("close");
      serverClosed.resolve();
    },
  },
});

// The handshake never completes, so the client does not verify the certificate.
const client = connect({
  port: server.port,
  host: "127.0.0.1",
  servername: "localhost",
  ALPNProtocols: ["x/1"],
  rejectUnauthorized: false,
});
const clientConnected = await new Promise<boolean>(resolve => {
  client.on("secureConnect", () => resolve(true));
  client.on("error", () => resolve(false));
  client.on("close", () => resolve(false));
});
// stop(true) has to close the server side by itself. Its close handler runs
// when the callback returns, before the client can see any outcome, so a close
// that only the cleanup below causes does not count.
const serverClosedFirst = events.includes("close");
// If the server left the connection open, this closes it, so the events are
// printed and the test fails on them and not on a timeout.
client.destroy();
await serverClosed.promise;

console.log(JSON.stringify({ events, clientConnected, serverClosedFirst }));
