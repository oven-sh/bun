// Run with NODE_TLS_REJECT_UNAUTHORIZED=0 in the environment. That env var is
// a client-only knob in Node: it must not weaken the server's default
// client-cert enforcement under requestCert: true (issue #35092).
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const fixtures = join(import.meta.dir, "fixtures");
const serverKey = readFileSync(join(fixtures, "agent10-key.pem"), "utf8");
const serverCert = readFileSync(join(fixtures, "agent10-cert.pem"), "utf8");
const serverCa = readFileSync(join(fixtures, "ca2-cert.pem"), "utf8");
const clientKey = readFileSync(join(fixtures, "ec10-key.pem"), "utf8");
const clientCertChain = readFileSync(join(fixtures, "ec10-cert.pem"), "utf8");
const clientCa = readFileSync(join(fixtures, "ca5-cert.pem"), "utf8");

// Just the end-entity cert, without the subordinate CA: the server cannot
// verify it, so the connection must be rejected by default.
const clientSingleCert = (/([^]*?END CERTIFICATE-----\r?\n)-----BEGIN/.exec(clientCertChain) as RegExpExecArray)[1];

let handled = 0;
const server = tls.createServer(
  {
    key: serverKey,
    cert: serverCert,
    ca: clientCa,
    requestCert: true,
    // rejectUnauthorized deliberately unset: the default must stay true.
  },
  socket => {
    handled++;
    socket.end();
  },
);
server.on("tlsClientError", () => {});
await once(server.listen(0, "127.0.0.1"), "listening");
const port = (server.address() as AddressInfo).port;

const client = tls.connect({
  host: "127.0.0.1",
  port,
  key: clientKey,
  cert: clientSingleCert,
  ca: serverCa,
  checkServerIdentity: () => undefined,
  rejectUnauthorized: false,
});
client.on("error", () => {});
await once(client, "close");
server.close();

console.log(handled === 0 ? "REJECTED" : "ACCEPTED");
