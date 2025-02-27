'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const assert = require('assert');
const h2 = require('http2');

// Makes sure that Http2ServerResponse setHeader & removeHeader, do not throw
// any errors if the stream was destroyed before headers were sent

const server = h2.createServer();
server.listen(0, "127.0.0.1", common.mustCall(function() {
  const port = server.address().port;
  server.once('request', common.mustCall(function(request, response) {
    response.on('finish', common.mustCall(() => {
      assert.strictEqual(response.headersSent, false);
      response.setHeader('test', 'value');
      response.removeHeader('test', 'value');

      process.nextTick(() => {
        response.setHeader('test', 'value');
        response.removeHeader('test', 'value');

        server.close();
      });
    }));


    response.destroy();
  }));

  const url = `http://127.0.0.1:${port}`;
  const client = h2.connect(url, common.mustCall(function() {
    const headers = {
      ':path': '/',
      ':method': 'GET',
      ':scheme': 'http',
      ':authority': `127.0.0.1:${port}`
    };
    const request = client.request(headers);
    request.on('end', common.mustCall(function() {
      client.close();
    }));
    request.end("hello");
    request.resume();
  }));
}));
