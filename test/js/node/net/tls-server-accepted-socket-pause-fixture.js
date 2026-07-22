"use strict";
// TLS sibling of net-server-accepted-socket-pause-fixture.js: pause() inside
// 'secureConnection' must be honored by ServerHandlers.handshake's post-emit
// resume() gate.
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const keys = path.join(__dirname, "..", "test", "fixtures", "keys");

function waitFor(cond) {
  return new Promise(resolve => {
    const check = () => (cond() ? resolve() : setImmediate(check));
    check();
  });
}

(async () => {
  let acc;
  const server = tls.createServer({
    key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
    cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
  });
  server.on("secureConnection", s => {
    acc = s;
    s.on("error", () => {});
    s.pause();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const cli = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false });
  cli.on("error", () => {});
  await once(cli, "secureConnect");
  await waitFor(() => acc);
  console.log("flowing", acc.readableFlowing);

  const chunk = Buffer.alloc(64 * 1024, 0x61);
  let writes = 0;
  let drains = 0;
  cli.on("drain", () => drains++);
  while (writes < 4000) {
    writes++;
    if (!cli.write(chunk)) break;
  }
  let turns = 0;
  await waitFor(() => drains > 0 || ++turns > 200);
  // drains can be >0 under TLS (engine-internal buffering flushes to the
  // kernel independently of the peer's read state); the distinguishing
  // observables are readableFlowing and whether the bytes are delivered.
  console.log("backpressured", writes < 4000);

  let got = 0;
  acc.on("data", d => (got += d.length));
  acc.resume();
  const want = writes * chunk.length;
  let dturns = 0;
  await waitFor(() => got >= want || acc.destroyed || ++dturns > 2000);
  console.log("delivered", got === want);

  cli.destroy();
  acc.destroy();
  server.close();
})().then(
  () => process.exit(0),
  err => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  },
);
