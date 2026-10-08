// A cluster worker's listen() completes only when the primary answers. This
// worker calls setSecureContext() and addContext() before that, then reports
// the certificates it serves.
import cluster from "node:cluster";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

const fixture = name => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const pair = agent => ({ key: fixture(`${agent}-key.pem`), cert: fixture(`${agent}-cert.pem`) });

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", served => {
    console.log(JSON.stringify(served));
    worker.kill();
  });
  worker.on("exit", () => process.exit(0));
} else {
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
  process.send({
    handleAfterListen,
    default: await presented(undefined),
    viaAddContext: await presented("sni.example"),
  });
  server.close();
}
