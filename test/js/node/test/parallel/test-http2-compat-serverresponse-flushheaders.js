'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const assert = require('assert');
const h2 = require('http2');

// Http2ServerResponse.flushHeaders

let serverResponse;

const server = h2.createServer();
server.listen(0, "127.0.0.1", common.mustCall(function mustCallListenFn() {
  const port = server.address().port;
  server.once('request', common.mustCall(function mustCallRequestFn(request, response) {
    serverResponse = response;
    assert.strictEqual(response.headersSent, false);
    assert.strictEqual(response._header, false); // Alias for headersSent

    console.error('response.flushHeaders()');
    response.flushHeaders();
    assert.strictEqual(response.headersSent, true);
    assert.strictEqual(response._header, true);
    response.flushHeaders(); // Idempotent

    assert.throws(() => {
      response.writeHead(400, { 'foo-bar': 'abc123' });
    }, {
      code: 'ERR_HTTP2_HEADERS_SENT'
    });

    response.on('finish', common.mustCall(function mustCallFinishFn() {
      console.error('response.finish()');
      server.close();
      process.nextTick(() => {
        response.flushHeaders(); // Idempotent
      });
    }));
    
  }));

  const url = `http://localhost:${port}`;
  const client = h2.connect(url, common.mustCall(function connectFn() {
    const headers = {
      ':path': '/',
      ':method': 'GET',
      ':scheme': 'http',
      ':authority': `localhost:${port}`
    };
    const request = client.request(headers);
    request.on('response', common.mustCall(function mustCallReponseFn(headers, flags) {
      assert.strictEqual(headers['foo-bar'], undefined);
      assert.strictEqual(headers[':status'], 200);
      console.error('serverResponse.end()');
      serverResponse.end();
    }, 1));
    request.on('close', common.mustCall(function mustCallCloseFn() {
      console.error('request closed');
    }));
    request.on('end', common.mustCall(function mustCallEndFn() {
      console.error("client.close()");
      client.close();
    }));
    request.end();
    request.resume();
  }));
}));