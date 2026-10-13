// Runs as a cluster worker, whose listen() completes only when the primary
// answers. It calls setSecureContext() and addContext() before that, then
// reports the certificates it serves.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

const fixture = name => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const pair = agent => ({ key: fixture(`${agent}-key.pem`), cert: fixture(`${agent}-cert.pem`) });

const server = tls.createServer(pair("agent1"), socket => socket.end());
server.listen(0, "127.0.0.1");
const handleAfterListen = server._handle == null ? "none" : "set";
server.setSecureContext(pair("agent3"));
server.addContext("sni.example", pair("agent2"));
await once(server, "listening");

const { port } = server.address();
const presented = async servername => {
  const client = tls.connect({ port, host: "127.0.0.1", servername, rejectUnauthorized: false });
  try {
    await once(client, "secureConnect");
    return client.getPeerCertificate().subject.CN;
  } finally {
    client.destroy();
  }
};
const [byDefault, viaAddContext] = await Promise.all([presented(undefined), presented("sni.example")]);
process.send({ handleAfterListen, default: byDefault, viaAddContext });
server.close();
