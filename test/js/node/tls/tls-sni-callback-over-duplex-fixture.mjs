// What an SNICallback is given, and what its answer does, when the TLS engine runs over a
// stream that has no fd to adopt. One report per run. Runs on bun and on node.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { duplexPair } from "node:stream";
import tls from "node:tls";

const [door, maxVersion] = process.argv.slice(2);
const pem = name => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const agent1 = { key: pem("agent1-key.pem"), cert: pem("agent1-cert.pem") };
const agent2 = { key: pem("agent2-key.pem"), cert: pem("agent2-cert.pem") };
const selected = tls.createSecureContext(agent2);
const servername = "sni.test";
// A handshake timeout is an unref'd timer, and a stream pair holds no handle.
setInterval(() => {}, 1 << 30);
const turns = async n => {
  for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve));
};

const answers = {
  "sync": cb => cb(null, selected),
  "async": cb => setImmediate(cb, null, selected),
  "raw native context": cb => cb(null, selected.context),
  "nothing": cb => cb(null, null),
  "async nothing": cb => setImmediate(cb),
  "cb(err)": cb => cb(new Error("boom")),
  "async cb(err)": cb => setImmediate(cb, new Error("boom")),
  "not a context": cb => cb(null, {}),
  "throw": () => {
    throw new Error("boom");
  },
};

// The two ends of the stream that the TLS pair runs over.
async function transports() {
  if (door === "tls-in-tls") {
    const [outerServerSide, outerClientSide] = duplexPair();
    const outerServer = new tls.TLSSocket(outerServerSide, { isServer: true, ...agent1 });
    const outerClient = tls.connect({ socket: outerClientSide, rejectUnauthorized: false });
    await Promise.all([once(outerServer, "secure"), once(outerClient, "secureConnect")]);
    return { server: outerServer, client: outerClient, close: () => outerClient.destroy() };
  }
  if (door === "queued-write") {
    const listener = net.createServer().listen(0, "127.0.0.1");
    await once(listener, "listening");
    const client = net.connect(listener.address().port, "127.0.0.1");
    const [server] = await once(listener, "connection");
    listener.close();
    // A plain write that is still queued when the socket is wrapped (a STARTTLS reply).
    server.cork();
    server.write("220 ready\r\n");
    return {
      server,
      client,
      wrapped: () => process.nextTick(() => server.uncork()),
      ready: () => once(client, "data"),
      close: () => client.destroy(),
    };
  }
  const [server, client] = duplexPair();
  return { server, client, close() {} };
}

const report = {};

// One connection. `answer` is what the SNICallback does with its `cb`. No `answer`: the server has no SNICallback.
function start(name, answer, { serverOptions, clientOptions = { servername }, configure, wrapped } = {}) {
  const events = (report[name] = []);
  const state = { events, asked: Promise.withResolvers() };
  // node also reports the reset that follows a refusal.
  const onServerError = err => err.code === "ECONNRESET" || events.push(`server error ${err.code ?? err.message}`);
  function SNICallback(name, cb) {
    state.owner = this;
    const owner =
      this === state.serverSocket
        ? "the TLSSocket"
        : state.server && this?.server === state.server
          ? "a TLSSocket of the server"
          : "?";
    events.push(`SNICallback(${name}) on ${owner}`);
    state.asked.resolve(cb);
    answer.call(this, cb);
  }
  const options = { ...agent1, maxVersion, ...(answer && { SNICallback }), ...serverOptions };

  const connect = async transport => {
    await transport.ready?.();
    const client = tls.connect({ socket: transport.client, rejectUnauthorized: false, maxVersion, ...clientOptions });
    client.on("error", err => events.push(`client error ${err.code}`));
    client.on("secureConnect", () => {
      events.push(`client secureConnect ${client.getPeerCertificate().subject.CN}`);
      client.destroy();
    });
    state.client = client;
  };

  const wrap = transport => {
    if (door === "emit") {
      state.server = tls.createServer(options).on("tlsClientError", (err, socket) => {
        onServerError(err);
        // node reports the timeout and leaves the connection to the listener.
        if (err.code === "ERR_TLS_HANDSHAKE_TIMEOUT") socket.destroy();
      });
      configure?.(state.server);
      state.server.emit("connection", transport.server);
    } else {
      state.serverSocket = new tls.TLSSocket(transport.server, { isServer: true, ...options });
      state.serverSocket.on("error", onServerError);
    }
    transport.wrapped?.();
    wrapped?.(state);
  };

  state.closed = (async () => {
    const transport = await transports();
    // "staged": the ClientHello is there before the server's engine starts.
    if (door === "staged") await connect(transport);
    wrap(transport);
    if (door !== "staged") await connect(transport);
    // Not events.once(): that one rejects on 'error'.
    await new Promise(resolve => state.client.once("close", resolve));
    transport.close();
  })();
  return state;
}
const handshake = (...args) => start(...args).closed;

// Each door runs the three ways an answer reaches the engine. "wrap" runs every answer.
const names = door === "wrap" ? Object.keys(answers) : ["sync", "async", "async cb(err)"];
for (const name of names) await handshake(name, answers[name]);

if (door === "emit") {
  for (const [name, pattern] of [
    ["addContext()", servername],
    ["addContext() wildcard", "*.test"],
  ]) {
    await handshake(name, null, { configure: server => server.addContext(pattern, agent2) });
  }
  // node gives the wrap the server's contexts only when the server has one at that time.
  await handshake("addContext() after the wrap, none before", null, {
    wrapped: state => state.server.addContext(servername, agent2),
  });
  await handshake("addContext() after the wrap, one before", null, {
    configure: server => server.addContext("other.test", agent1),
    wrapped: state => state.server.addContext(servername, agent2),
  });
  await handshake("an SNICallback that never answers", () => {}, { serverOptions: { handshakeTimeout: 100 } });
}

if (door === "wrap") {
  await handshake("no server_name", answers.sync, { clientOptions: {} });
  await handshake("a replaced _SNICallback", answers.sync, {
    wrapped(state) {
      state.serverSocket._SNICallback = function (name, cb) {
        state.events.push(`the replacement(${name})`);
        cb(null, selected);
      };
    },
  });

  // The callback is pending when its connection goes away. A late answer does nothing.
  for (const [name, leave] of [
    ["destroy() while the SNICallback is pending", state => state.owner.destroy()],
    ["the peer leaves while the SNICallback is pending", state => state.client.destroy()],
  ]) {
    const state = start(name, () => {});
    const cb = await Promise.race([state.asked.promise, state.closed]);
    if (!cb) continue;
    leave(state);
    await state.closed;
    await turns(2);
    cb(null, selected);
    await turns(2);
    state.events.push("the late answer did nothing");
  }

  // Never fed: no ClientHello, so no call, and the server side writes nothing.
  const [server, client] = duplexPair();
  let bytes = 0;
  client.on("data", chunk => (bytes += chunk.length));
  report["never fed"] = [];
  const socket = new tls.TLSSocket(server, {
    isServer: true,
    ...agent1,
    SNICallback: () => report["never fed"].push("SNICallback"),
  });
  await turns(10);
  report["never fed"].push(`${bytes} bytes written`);
  socket.destroy();
}

console.log(JSON.stringify(report));
process.exit(0);
