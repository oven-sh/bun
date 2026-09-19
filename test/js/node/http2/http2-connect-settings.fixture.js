// Give http2.connect() an options.settings value it cannot use, over each kind of socket, and
// report what the caller observes. node-http2.test.js runs this in-process under Bun and as a
// script under Node.js: both must report the same outcomes.
const http2 = require("node:http2");
const net = require("node:net");
const { once } = require("node:events");
const { Duplex } = require("node:stream");

function serve(server) {
  server.on("sessionError", () => {});
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  server.listen(0, "127.0.0.1");
  return once(server, "listening");
}

// What one connect() call does: the error it throws, or the session's events in order and the
// outcome of a request made while the socket was still connecting. `closeEarly` also calls
// close() before the socket connects.
function observe(url, options, closeEarly = false) {
  const events = [];
  let client;
  try {
    client = http2.connect(url, { rejectUnauthorized: false, ...options }, () => events.push("listener"));
  } catch (e) {
    return { thrown: `${e.code}: ${e.message}` };
  }
  client.on("connect", () => events.push("connect"));
  client.on("error", e => events.push(`error ${e.code}: ${e.message}`));
  const { promise, resolve } = Promise.withResolvers();
  let request;
  const req = client.request({ ":path": "/" });
  req.on("response", headers => (request = `status ${headers[":status"]}`));
  req.on("error", e => (request = `${e.code} caused by ${e.cause?.code}`));
  req.on("close", () => client.close());
  req.resume();
  req.end();
  if (closeEarly) client.close();
  client.on("close", () => {
    events.push("close");
    resolve({ events, request });
  });
  return promise;
}

async function observeConnectSettings(tlsOptions) {
  const plain = http2.createServer();
  const secure = http2.createSecureServer(tlsOptions);
  try {
    await Promise.all([serve(plain), serve(secure)]);
    const port = plain.address().port;
    const http = `http://127.0.0.1:${port}`;
    const https = `https://127.0.0.1:${secure.address().port}`;
    const invalid = { initialWindowSize: -1 };

    // This connect() uses a socket that this function owns. If it throws, the socket is
    // destroyed and the other cases do not run: each of them would leave a connecting socket
    // that nothing owns.
    const connecting = net.connect(port, "127.0.0.1");
    const outcomes = { "connecting socket": observe(http, { settings: invalid, createConnection: () => connecting }) };
    if (outcomes["connecting socket"].thrown) {
      connecting.destroy();
      return outcomes;
    }

    // A stream that is not connecting counts as connected: connect() sets the session up inline.
    const connected = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        callback();
      },
    });
    outcomes["connected socket"] = observe(http, { settings: invalid, createConnection: () => connected });
    connected.destroy();

    // Every connect() below starts before the first of them settles.
    Object.assign(outcomes, {
      "http null": observe(http, { settings: null }),
      "http array": observe(http, { settings: [] }),
      "http invalid": observe(http, { settings: invalid }),
      "http invalid, closed early": observe(http, { settings: invalid }, true),
      "http number": observe(http, { settings: 1 }),
      "http string": observe(http, { settings: "x" }),
      "http boolean": observe(http, { settings: true }),
      "http function": observe(http, { settings() {} }),
      "https null": observe(https, { settings: null }),
      "https array": observe(https, { settings: [] }),
      "https number": observe(https, { settings: 1 }),
      "https invalid": observe(https, { settings: invalid }),
    });
    for (const name in outcomes) outcomes[name] = await outcomes[name];
    return outcomes;
  } finally {
    plain.close();
    secure.close();
  }
}

module.exports = { observeConnectSettings };

if (require.main === module) {
  observeConnectSettings(JSON.parse(process.argv[2])).then(outcomes => console.log(JSON.stringify(outcomes)));
}
