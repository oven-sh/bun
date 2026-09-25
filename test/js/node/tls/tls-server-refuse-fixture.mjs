// A TLS server that turns the client down once its own handshake is done.
// report(mode, version) makes one connection and resolves with what both
// sides saw. node-tls-connect.test.ts runs it in bun and in node, and expects
// the same reports from both.
//
// In a full TLS 1.2 handshake the server's Finished is the last message, and
// the server's handshake callback runs before it is sent. In TLS 1.3 the
// server has nothing left to send at that point.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

const keys = join(import.meta.dirname, "..", "test", "fixtures", "keys");
const pem = name => readFileSync(join(keys, name));

export async function report(mode, version) {
  // The client certificate (agent3) is not signed by ca1, so the server cannot verify it.
  const serverDone = Promise.withResolvers();
  let serverEvent = null;
  const server = tls.createServer({
    key: pem("agent1-key.pem"),
    cert: pem("agent1-cert.pem"),
    ca: pem("ca1-cert.pem"),
    requestCert: true,
    rejectUnauthorized: mode === "requestCert and rejectUnauthorized",
    minVersion: version,
    maxVersion: version,
  });
  server.on("secureConnection", socket => {
    serverEvent = "secureConnection";
    socket.on("error", () => {});
    socket.on("close", () => serverDone.resolve());
    if (mode === "destroy() in 'secureConnection'") socket.destroy();
    else socket.end();
  });
  server.on("tlsClientError", () => {
    serverEvent = "tlsClientError";
    serverDone.resolve();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const client = { secureConnect: false, error: null };
  const socket = tls.connect({
    host: "127.0.0.1",
    port: server.address().port,
    ca: pem("ca1-cert.pem"),
    servername: "agent1",
    key: pem("agent3-key.pem"),
    cert: pem("agent3-cert.pem"),
  });
  socket.on("secureConnect", () => (client.secureConnect = true));
  socket.on("error", error => (client.error = error.code));
  socket.resume();
  await Promise.all([new Promise(resolve => socket.on("close", resolve)), serverDone.promise]);
  server.close();
  return { client, server: serverEvent };
}
