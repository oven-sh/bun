'use strict';

const common = require('../common');

// This test verifies that `tls.connect()` honors the `allowHalfOpen` option.

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const fixtures = require('../common/fixtures');
const tls = require('tls');

{
  const socket = tls.connect({ port: 42, lookup() {} });
  console.log('Default allowHalfOpen:', socket.allowHalfOpen);
  assert.strictEqual(socket.allowHalfOpen, false);
}

{
  const socket = tls.connect({ port: 42, allowHalfOpen: false, lookup() {} });
  console.log('Explicit allowHalfOpen=false:', socket.allowHalfOpen);
  assert.strictEqual(socket.allowHalfOpen, false);
}

const server = tls.createServer({
  key: fixtures.readKey('agent1-key.pem'),
  cert: fixtures.readKey('agent1-cert.pem'),
}, common.mustCall((socket) => {
  console.log('Server: New connection received');
  server.close();

  let message = '';

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    console.log('Server received:', chunk);
    message += chunk;

    if (message === 'Hello') {
      console.log('Server sending response');
      socket.end(message);
      message = '';
    }
  });

  socket.on('end', common.mustCall(() => {
    console.log('Server received end, final message:', message);
    assert.strictEqual(message, 'Bye');
  }));
}));

server.listen(0, common.mustCall(() => {
  console.log('Server listening on port:', server.address().port);
  const socket = tls.connect({
    port: server.address().port,
    rejectUnauthorized: false,
    allowHalfOpen: true,
  }, common.mustCall(() => {
    console.log('Client connected');
    let message = '';

    socket.on('data', (chunk) => {
      console.log('Client received:', chunk);
      message += chunk;
    });

    socket.on('end', common.mustCall(() => {
      console.log('Client received end, message:', message);
      assert.strictEqual(message, 'Hello');

      setTimeout(() => {
        console.log('Client writing final message');
        assert(socket.writable);
        assert(socket.write('Bye'));
        // socket.end();
      }, 50);
    }));

    console.log('Client writing initial message');
    socket.write('Hello');
  }));

  socket.setEncoding('utf8');
}));
