process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");

// A keep-alive agent reuses the same TCP socket for sequential requests. The
// native socket's data callback captures the async context at connect time,
// so on a reused connection the 'response'/'data'/'end' path must re-enter the
// owning ClientRequest's context rather than inherit the first request's.

const als = new AsyncLocalStorage();
let failed = false;
const sockets = [];

const server = http.createServer((req, res) => res.end("ok"));

server.listen(0, "127.0.0.1", () => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

  function check(want, what) {
    const got = als.getStore();
    if (got !== want) {
      console.error(`FAIL: ${what} for ${want} saw ${JSON.stringify(got)}`);
      failed = true;
    }
  }

  function one(store) {
    return new Promise((resolve, reject) => {
      als.run(store, () => {
        const req = http.request(
          { host: "127.0.0.1", port: server.address().port, path: "/", agent },
          res => {
            check(store, "response callback");
            res.on("data", () => check(store, "response 'data'"));
            res.on("end", () => {
              check(store, "response 'end'");
              resolve();
            });
            res.on("error", reject);
          },
        );
        req.on("socket", s => {
          sockets.push(s);
          check(store, "'socket' event");
        });
        req.on("close", () => check(store, "'close' event"));
        req.on("error", reject);
        req.end();
      });
    });
  }

  (async () => {
    await one("R1");
    // Wait for the socket to be returned to the free pool.
    await new Promise(r => setImmediate(() => setImmediate(r)));
    await one("R2");
    await one("R3");

    if (sockets[0] !== sockets[1] || sockets[1] !== sockets[2]) {
      console.error("FAIL: keep-alive socket was not reused");
      failed = true;
    }

    agent.destroy();
    server.close();
    process.exit(failed ? 1 : 0);
  })().catch(err => {
    console.error(err);
    agent.destroy();
    server.close();
    process.exit(1);
  });
});
