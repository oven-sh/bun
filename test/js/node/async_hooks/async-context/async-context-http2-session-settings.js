process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http2 = require("http2");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;
const seen = new Set();

function check(name) {
  const store = asyncLocalStorage.getStore();
  seen.add(name);
  if (store?.test !== "http2.Http2Session.settings") {
    console.error(`FAIL: http2 ${name} lost context, got`, store);
    failed = true;
  }
}

// The sessions are made outside the store. settings() is called inside it, once the SETTINGS frame
// that a session sends by itself is acknowledged.
function settingsInStore(session, side, done) {
  session.once("localSettings", () => {
    session.once("localSettings", () => {
      check(`${side} 'localSettings'`);
      done();
    });
    asyncLocalStorage.run({ test: "http2.Http2Session.settings" }, () => {
      session.settings({}, () => check(`${side} settings() callback`));
    });
  });
}

const server = http2.createServer();
let pending = 2;
function done() {
  if (--pending !== 0) return;
  client.close();
  server.close();
  for (const side of ["client", "server"]) {
    for (const name of [`${side} settings() callback`, `${side} 'localSettings'`]) {
      if (!seen.has(name)) {
        console.error(`FAIL: http2 ${name} never ran`);
        failed = true;
      }
    }
  }
  process.exit(failed ? 1 : 0);
}
server.on("session", session => settingsInStore(session, "server", done));
let client;
server.listen(0, "127.0.0.1", () => {
  client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  settingsInStore(client, "client", done);
});
