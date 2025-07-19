const common = require('../common');
const Countdown = require('../common/countdown');
const assert = require('assert');
const http = require('http');

const N = 4;
const M = 4;
const server = http.Server(common.mustCall(function(req, res) {
  res.writeHead(200);
  res.end('hello world\n');
}, (N * M))); // N * M = good requests (the errors will not be counted)

function makeRequests(outCount, inCount, shouldFail) {
  const countdown = new Countdown(
    outCount * inCount,
    common.mustCall(() => server.close())
  );
  let onRequest = common.mustNotCall(); // Temporary
  const p = new Promise((resolve) => {
    onRequest = common.mustCall((res) => {
      if (countdown.dec() === 0) {
        resolve();
      }

      if (!shouldFail)
        res.resume();
    }, outCount * inCount);
  });

  server.listen(0, () => {
    const port = server.address().port;
    for (let i = 0; i < outCount; i++) {
      setTimeout(() => {
        for (let j = 0; j < inCount; j++) {
          const req = http.get({ port: port, path: '/' }, onRequest);
          if (shouldFail)
            req.on('error', common.mustCall(onRequest));
          else
            req.on('error', (e) => assert.fail(e));
        }
      }, i);
    }
  });
  return p;
}

const test1 = makeRequests(N, M);

const test2 = () => {
  // Should not explode if can not create sockets.
  // Ref: https://github.com/nodejs/node/issues/13045
  // Ref: https://github.com/nodejs/node/issues/13831
  http.Agent.prototype.createConnection = function createConnection(_, cb) {
    process.nextTick(cb, new Error('nothing'));
  };
  return makeRequests(N, M, true);
};

test1
  .then(test2)
  .catch((e) => {
    // This is currently the way to fail a test with a Promise.
    console.error(e);
    process.exit(1);
  }
  );
