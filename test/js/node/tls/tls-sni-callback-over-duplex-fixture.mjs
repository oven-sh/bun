// What an SNICallback may do to the connection it is answering for, when the TLS
// engine runs over a stream. The engine holds the handshake until the answer.
// One report per run. Runs on bun and on node.
import { duplexPair } from "node:stream";
import tls from "node:tls";

const [door, maxVersion] = process.argv.slice(2);
const { TLS_KEY: key, TLS_CERT: cert } = process.env;
const context = tls.createSecureContext({ key, cert });

const actions = {
  // Inside the question.
  "answer"(cb) {
    cb(null, context);
  },
  "answer twice"(cb) {
    cb(null, context);
    cb(null, context);
  },
  "answer, then fail"(cb) {
    cb(null, context);
    cb(new Error("boom"));
  },
  "destroy(), then answer"(cb) {
    this.destroy();
    cb(null, context);
  },
  "destroy(err), then answer"(cb) {
    this.destroy(new Error("boom"));
    cb(null, context);
  },
  "destroy() the transport, then answer"(cb, current) {
    current.transport.destroy();
    cb(null, context);
  },
  "destroy() the client, then answer"(cb, current) {
    current.client.destroy();
    cb(null, context);
  },
  "throw"() {
    throw new Error("boom");
  },
  // While the answer is pending.
  "answer later"(cb) {
    setImmediate(cb, null, context);
  },
  "answer later, twice"(cb) {
    setImmediate(() => {
      cb(null, context);
      cb(null, context);
    });
  },
  "destroy(), then answer later"(cb) {
    this.destroy();
    setImmediate(cb, null, context);
  },
  "destroy() later, then answer"(cb) {
    setImmediate(() => {
      this.destroy();
      cb(null, context);
    });
  },
  "destroy() the client, then answer later"(cb, current) {
    current.client.destroy();
    setImmediate(cb, null, context);
  },
  "end(), then answer later"(cb) {
    this.end();
    setImmediate(cb, null, context);
  },
};

let current;
const options = {
  key,
  cert,
  maxVersion,
  SNICallback(_name, cb) {
    return current.action.call(this, cb, current);
  },
};
// One server for each case, so that a late error is reported for the case that caused it.
// node also reports a bare destroy() as ECONNRESET to 'tlsClientError'.
const errorsTo = events => err => err.code === "ECONNRESET" || events.push(`server error ${err.message}`);

const report = {};
for (const [name, action] of Object.entries(actions)) {
  const [transport, clientTransport] = duplexPair();
  const events = (report[name] = []);
  current = { action, transport, events };
  const connect = () => {
    const client = tls.connect({ socket: clientTransport, servername: "name.test", rejectUnauthorized: false });
    client.on("error", err => events.push(`client error ${err.code}`));
    client.on("secureConnect", () => {
      events.push("client secureConnect");
      client.destroy();
    });
    current.client = client;
  };
  // "staged": the ClientHello is there before the server's engine starts.
  if (door === "staged") connect();
  if (door === "emit") tls.createServer(options).on("tlsClientError", errorsTo(events)).emit("connection", transport);
  else new tls.TLSSocket(transport, { isServer: true, ...options }).on("error", errorsTo(events));
  if (door !== "staged") connect();
  await new Promise(resolve => current.client.on("close", resolve));
}
console.log(JSON.stringify(report));
