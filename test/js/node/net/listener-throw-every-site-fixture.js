// Each listener and callback that node:net and node:tls call from a socket event throws once: 'connection',
// 'data', onread.callback with a buffer and with a buffer function that returns none, 'secureConnection',
// 'secureConnect' and checkServerIdentity. Each must reach uncaughtException, and nothing else.
// TLS_FIXTURE is the JSON-encoded { cert, key } pair to serve with.
// node: ["uncaught:connection","uncaught:data","uncaught:onread buffer","uncaught:onread function",
//        "uncaught:secureConnection","uncaught:secureConnect","uncaught:checkServerIdentity"]
const net = require("node:net");
const tls = require("node:tls");
const { once } = require("node:events");

const cert = JSON.parse(process.env.TLS_FIXTURE);
const ev = [];
process.on("uncaughtException", e => ev.push("uncaught:" + e.message));
const onError = e => ev.push("socket-error:" + e.message);

async function listening(server) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  return server.address().port;
}

async function connectionAndData() {
  const server = net.createServer(socket => {
    socket.on("error", onError);
    socket.on("data", () => {
      socket.end();
      throw new Error("data");
    });
    throw new Error("connection");
  });
  const client = net.connect(await listening(server), "127.0.0.1", () => client.write("x"));
  client.on("error", onError);
  await once(client.resume(), "close");
  server.close();
}

async function onread(buffer, message) {
  const server = net.createServer(socket => socket.end("x"));
  const client = net.connect({
    port: await listening(server),
    host: "127.0.0.1",
    onread: {
      buffer,
      callback() {
        throw new Error(message);
      },
    },
  });
  client.on("error", onError);
  await once(client, "close");
  server.close();
}

async function handshake(message, options, listen) {
  const thrown = Promise.withResolvers();
  const fail = () => {
    // The throw has to leave the listener first.
    setImmediate(thrown.resolve);
    throw new Error(message);
  };
  // What the teardown below does to the other side is not the subject.
  let over = false;
  const onHandshakeError = e => over || onError(e);
  const server = tls.createServer(cert, socket => socket.on("error", onHandshakeError));
  const client = tls.connect({
    port: await listening(server),
    host: "127.0.0.1",
    ca: cert.cert,
    servername: "localhost",
    ...options(fail),
  });
  client.on("error", onHandshakeError);
  listen(fail, server, client);
  await thrown.promise;
  over = true;
  client.destroy();
  server.close();
}

(async () => {
  await connectionAndData();
  await onread(Buffer.alloc(16), "onread buffer");
  await onread(() => null, "onread function");
  await handshake(
    "secureConnection",
    () => ({}),
    (fail, server) => server.on("secureConnection", fail),
  );
  await handshake(
    "secureConnect",
    () => ({}),
    (fail, server, client) => client.on("secureConnect", fail),
  );
  await handshake(
    "checkServerIdentity",
    fail => ({ checkServerIdentity: fail }),
    () => {},
  );
  console.log(JSON.stringify(ev));
  process.exit(0);
})();
