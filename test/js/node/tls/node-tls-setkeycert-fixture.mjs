// One handshake for each TLS version with a listening server whose SNICallback calls setKeyCert() and answers from a
// microtask. The server also has an ALPNCallback, and gave the same context to addContext(). Prints what each client
// got and how many times the ALPNCallback ran. Runs on Bun and on Node.js.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

const keys = join(import.meta.dirname, "..", "test", "fixtures", "keys");
const identity = name => ({
  key: readFileSync(join(keys, `${name}-key.pem`)),
  cert: readFileSync(join(keys, `${name}-cert.pem`)),
});
const context = tls.createSecureContext(identity("agent1"));

for (const version of ["TLSv1.2", "TLSv1.3"]) {
  let calls = 0;
  let accepted;
  const server = tls.createServer(
    {
      ...identity("agent2"),
      ALPNCallback({ protocols }) {
        calls++;
        return protocols[0];
      },
      async SNICallback(_, answer) {
        // Node.js calls it with the socket as `this`. Bun emits 'connection' with that socket.
        (this instanceof tls.TLSSocket ? this : accepted).setKeyCert(context);
        await Promise.resolve();
        answer(null);
      },
    },
    socket => socket.on("error", () => {}).end(),
  );
  server.addContext("other.test", context);
  server.on("connection", socket => (accepted = socket));
  server.on("tlsClientError", () => {});
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = tls.connect({
    port: server.address().port,
    host: "127.0.0.1",
    servername: "a.test",
    ALPNProtocols: ["h2"],
    rejectUnauthorized: false,
    minVersion: version,
    maxVersion: version,
  });
  const result = await once(client, "secureConnect").then(
    () => ({ cn: client.getPeerCertificate().subject.CN, alpn: client.alpnProtocol }),
    err => ({ error: err.code ?? err.message }),
  );
  console.log(JSON.stringify({ version, ...result, calls }));
  client.destroy();
  server.close();
}
