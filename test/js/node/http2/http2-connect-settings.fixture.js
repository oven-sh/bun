// Give http2.connect() an options.settings value it cannot use, over each kind of socket, and
// report what the caller observes. node-http2-connect-settings.test.ts runs the groups in-process
// under Bun and runs this file as a script under Node.js: both must report the same outcomes.
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

async function settled(outcomes) {
  for (const name in outcomes) outcomes[name] = await outcomes[name];
  return outcomes;
}

// Starts the two servers and returns the groups of cases. Every connect() in a group starts
// before the first of them settles.
async function start(tlsOptions) {
  const plain = http2.createServer();
  const secure = http2.createSecureServer(tlsOptions);
  await Promise.all([serve(plain), serve(secure)]);
  const port = plain.address().port;
  const plainUrl = `http://127.0.0.1:${port}`;
  const secureUrl = `https://127.0.0.1:${secure.address().port}`;
  const invalid = { initialWindowSize: -1 };
  const connectPlain = () => net.connect(port, "127.0.0.1");

  // This connect() uses a socket that this function owns. If it throws, the socket is destroyed
  // and no group makes another connect(): a connect() that throws after it made its own socket
  // leaves that socket connecting, and this process has no way to get rid of it.
  const connecting = connectPlain();
  const first = observe(plainUrl, { settings: invalid, createConnection: () => connecting });
  if (first.thrown) connecting.destroy();
  const group = cases => (first.thrown ? { "connecting socket": first } : settled(cases()));

  return {
    close() {
      plain.close();
      secure.close();
    },
    createConnection: () =>
      group(() => {
        // A stream that is not connecting counts as connected: connect() sets the session up inline.
        const connected = new Duplex({
          read() {},
          write(chunk, encoding, callback) {
            callback();
          },
        });
        const outcomes = {
          "connecting socket": first,
          "connected socket": observe(plainUrl, { settings: invalid, createConnection: () => connected }),
          "https null": observe(secureUrl, { settings: null, createConnection: connectPlain }),
        };
        connected.destroy();
        return outcomes;
      }),
    http: () =>
      group(() => ({
        "null": observe(plainUrl, { settings: null }),
        "array": observe(plainUrl, { settings: [] }),
        "invalid": observe(plainUrl, { settings: invalid }),
        "invalid, closed with a request pending": observe(plainUrl, { settings: invalid }, true),
        "invalid, closed with nothing pending": observeClosedIdle(plainUrl, { settings: invalid }, false),
        "invalid, closed after its request was destroyed": observeClosedIdle(plainUrl, { settings: invalid }, true),
        "number": observe(plainUrl, { settings: 1 }),
        "string": observe(plainUrl, { settings: "x" }),
        "boolean": observe(plainUrl, { settings: true }),
        "function": observe(plainUrl, { settings() {} }),
      })),
    https: () =>
      group(() => ({
        "null": observe(secureUrl, { settings: null }),
        "array": observe(secureUrl, { settings: [] }),
        "number": observe(secureUrl, { settings: 1 }),
        "invalid": observe(secureUrl, { settings: invalid }),
      })),
  };
}

module.exports = { start };

if (require.main === module) {
  (async () => {
    const fixture = await start(JSON.parse(process.argv[2]));
    const outcomes = {};
    for (const name of ["createConnection", "http", "https"]) outcomes[name] = await fixture[name]();
    fixture.close();
    console.log(JSON.stringify(outcomes));
  })();
}
