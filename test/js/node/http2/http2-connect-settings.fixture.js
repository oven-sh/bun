// Give http2.connect() an options.settings value it cannot use, over each kind of socket, and
// report what the caller observes. node-http2.test.js runs this in-process under Bun and as a
// script under Node.js: both must report the same outcomes.
const http2 = require("node:http2");
const net = require("node:net");
const { once } = require("node:events");
const { Duplex } = require("node:stream");

function serve(server) {
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  server.listen(0, "127.0.0.1");
  return once(server, "listening");
}

// What one connect() call does: the error it throws, or the session's events in order and the
// outcome of a request made while the socket was still connecting. The request's outcome is kept
// apart from the events, because which of the two errors comes first is not part of this test.
// `closeEarly` also calls close() before the socket connects.
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

// A session that close() was called on before the socket connects, with no live request. node
// has destroyed it by then and never reads options.settings. Only the errors are the same on
// every run: whether 'connect' is seen depends on which of the connect and the destroy is first.
function observeClosedIdle(url, options, destroyedRequest) {
  const errors = [];
  const client = http2.connect(url, options);
  client.on("error", e => errors.push(e.code));
  if (destroyedRequest) {
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    req.destroy();
  }
  client.close();
  return new Promise(resolve => client.on("close", () => resolve({ errors })));
}

async function observeConnectSettings(tlsOptions) {
  const plain = http2.createServer();
  const secure = http2.createSecureServer(tlsOptions);
  try {
    await Promise.all([serve(plain), serve(secure)]);
    const port = plain.address().port;
    const plainUrl = `http://127.0.0.1:${port}`;
    const secureUrl = `https://127.0.0.1:${secure.address().port}`;
    const invalid = { initialWindowSize: -1 };
    const connectPlain = () => net.connect(port, "127.0.0.1");

    // This connect() uses a socket that this function owns. If it throws, the socket is
    // destroyed and the other cases do not run. A connect() that throws after it made its own
    // socket leaves that socket connecting, and this process has no way to get rid of it.
    const connecting = connectPlain();
    const outcomes = {
      "connecting socket": observe(plainUrl, { settings: invalid, createConnection: () => connecting }),
    };
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
    outcomes["connected socket"] = observe(plainUrl, { settings: invalid, createConnection: () => connected });
    connected.destroy();

    // Every connect() below starts before the first of them settles.
    Object.assign(outcomes, {
      "http null": observe(plainUrl, { settings: null }),
      "http array": observe(plainUrl, { settings: [] }),
      "http invalid": observe(plainUrl, { settings: invalid }),
      "http invalid, closed with a request pending": observe(plainUrl, { settings: invalid }, true),
      "http invalid, closed with nothing pending": observeClosedIdle(plainUrl, { settings: invalid }, false),
      "http invalid, closed after its request was destroyed": observeClosedIdle(plainUrl, { settings: invalid }, true),
      "http number": observe(plainUrl, { settings: 1 }),
      "http string": observe(plainUrl, { settings: "x" }),
      "http boolean": observe(plainUrl, { settings: true }),
      "http function": observe(plainUrl, { settings() {} }),
      "https null": observe(secureUrl, { settings: null }),
      "https array": observe(secureUrl, { settings: [] }),
      "https number": observe(secureUrl, { settings: 1 }),
      "https invalid": observe(secureUrl, { settings: invalid }),
      "https null with createConnection": observe(secureUrl, { settings: null, createConnection: connectPlain }),
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
