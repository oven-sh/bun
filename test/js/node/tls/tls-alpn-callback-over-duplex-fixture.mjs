// What an ALPNCallback may do to the connection it is choosing for, when the TLS
// engine runs over a stream. The callback runs inside the engine's handshake call.
// One report per run. Runs on bun and on node.
import { duplexPair } from "node:stream";
import tls from "node:tls";

const [door, maxVersion] = process.argv.slice(2);
const { TLS_KEY: key, TLS_CERT: cert } = process.env;

const actions = {
  "destroy()"() {
    this.destroy();
    return "h2";
  },
  "destroy() and refuse"() {
    this.destroy();
  },
  "destroy(err)"() {
    this.destroy(new Error("boom"));
    return "h2";
  },
  "destroy() the client"(current) {
    current.client.destroy();
    return "h2";
  },
  "destroy() the transport"(current) {
    current.transport.destroy();
    return "h2";
  },
  "throw"() {
    throw new Error("boom");
  },
  "select"() {
    return "h2";
  },
};

let current;
const options = {
  key,
  cert,
  maxVersion,
  ALPNCallback() {
    return current.action.call(this, current);
  },
};
// node also reports a bare destroy() as ECONNRESET to 'tlsClientError'.
const onServerError = err => err.code === "ECONNRESET" || current.events.push(`server error ${err.message}`);
const server = tls.createServer(options).on("tlsClientError", onServerError);

const report = {};
for (const [name, action] of Object.entries(actions)) {
  const [transport, clientTransport] = duplexPair();
  const events = (report[name] = []);
  current = { action, transport, events };
  const connect = () => {
    const client = tls.connect({ socket: clientTransport, rejectUnauthorized: false, ALPNProtocols: ["h2"] });
    client.on("error", err => events.push(`client error ${err.code}`));
    client.on("secureConnect", () => {
      events.push(`client secureConnect ${client.alpnProtocol}`);
      client.destroy();
    });
    current.client = client;
  };
  // "staged": the ClientHello is there before the server's engine starts.
  if (door === "staged") connect();
  if (door === "emit") server.emit("connection", transport);
  else new tls.TLSSocket(transport, { isServer: true, ...options }).on("error", onServerError);
  if (door !== "staged") connect();
  await new Promise(resolve => current.client.on("close", resolve));
}
console.log(JSON.stringify(report));
