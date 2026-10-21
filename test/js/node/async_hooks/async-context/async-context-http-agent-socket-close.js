process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

function fail(message) {
  console.error(`FAIL: ${message}`);
  failed = true;
}

function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Sends a request in the store `store`. Resolves with the request once its response was read and the agent had a turn
// to take the socket back.
function request(module, agent, port, store) {
  return new Promise(resolve => {
    asyncLocalStorage.run(store, () => {
      const req = module.request({ host: "127.0.0.1", port, agent, rejectUnauthorized: false }, res => {
        res.resume();
        res.on("end", () => setImmediate(resolve, req));
      });
      req.on("error", err => fail(`the request of ${store} failed with ${err.code}`));
      req.end();
    });
  });
}

// When an http.Agent gives a kept-alive socket to its next request, node resets the socket's handle to the async context
// of that request (asyncResetHandle), and the handle's close callback, which emits 'close', runs there from then on. The
// handle under a TLS socket is not reset: its 'close' stays in the context of the request that opened the connection.
async function reuse(what, module, requests, expected) {
  const agent = new module.Agent({ keepAlive: true, maxSockets: 1 });
  const [first, second] = await requests(agent);
  if (second.socket !== first.socket) fail(`${what}: the second request did not reuse the socket`);
  const store = await new Promise(resolve => {
    second.socket.once("close", () => resolve(asyncLocalStorage.getStore()));
    asyncLocalStorage.run("destroy", () => second.socket.destroy());
  });
  if (store !== expected)
    fail(`'close' of ${what} ran in ${JSON.stringify(store)}, expected ${JSON.stringify(expected)}`);
  agent.destroy();
}

async function main() {
  const fixtures = path.join(__dirname, "..", "..", "tls", "fixtures");
  const tls = {
    key: fs.readFileSync(path.join(fixtures, "agent1-key.pem")),
    cert: fs.readFileSync(path.join(fixtures, "agent1-cert.pem")),
  };
  const respond = (req, res) => res.end("ok");
  const [plain, secure] = await Promise.all([
    listen(http.createServer(respond)),
    listen(https.createServer(tls, respond)),
  ]);
  const port = plain.address().port;
  const securePort = secure.address().port;

  // The second request finds the socket in the agent's pool.
  const fromPool = (module, port) => async agent => {
    const first = await request(module, agent, port, "first");
    return [first, await request(module, agent, port, "second")];
  };
  // The second request waits for the one socket, and gets it when the first request frees it.
  const queued = (module, port) => agent =>
    Promise.all([request(module, agent, port, "first"), request(module, agent, port, "second")]);

  await Promise.all([
    reuse("a socket taken from the pool", http, fromPool(http, port), "second"),
    reuse("a socket given to a queued request", http, queued(http, port), "second"),
    reuse("a TLS socket taken from the pool", https, fromPool(https, securePort), "first"),
  ]);

  plain.close();
  secure.close();
  process.exit(failed ? 1 : 0);
}

main();
