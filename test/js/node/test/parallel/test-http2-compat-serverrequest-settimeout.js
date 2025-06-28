'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const assert = require('assert');
const http2 = require('http2');

const msecs = common.platformTimeout(1);
const server = http2.createServer();

server.on('request', (req, res) => {
  const request = req.setTimeout(msecs, common.mustCall(() => {
    res.end();
  }));
  assert.strictEqual(request, req);
  req.on('timeout', common.mustCall());
  res.on('finish', common.mustCall(() => {
    req.setTimeout(msecs, common.mustNotCall());
    process.nextTick(() => {
      req.setTimeout(msecs, common.mustNotCall());
      server.close();
    });
  }));
});

server.listen(0, common.mustCall(() => {
  const port = server.address().port;
  const client = http2.connect(`http://127.0.0.1:${port}`);
  const req = client.request({
    ':path': '/',
    ':method': 'GET',
    ':scheme': 'http',
    ':authority': `127.0.0.1:${port}`
  });
  req.on('end', common.mustCall(() => {
    client.close();
  }));
  req.resume();
  req.end();
}));
