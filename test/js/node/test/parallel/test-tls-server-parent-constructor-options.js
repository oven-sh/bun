'use strict';
const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

// Test that `tls.Server` constructor options are passed to the parent
// constructor.

const assert = require('assert');
const fixtures = require('../common/fixtures');
const tls = require('tls');

const options = {
  key: fixtures.readKey('agent1-key.pem'),
  cert: fixtures.readKey('agent1-cert.pem'),
};

{
  console.log('Test case 1: Default options');
  const server = tls.createServer(options, common.mustCall((socket) => {
    console.log('Server socket created with default options');
    console.log('socket.allowHalfOpen:', socket.allowHalfOpen);
    console.log('socket.isPaused():', socket.isPaused());
    assert.strictEqual(socket.allowHalfOpen, false);
    assert.strictEqual(socket.isPaused(), false);
  }));

  console.log('Server default options:');
  console.log('server.allowHalfOpen:', server.allowHalfOpen);
  console.log('server.pauseOnConnect:', server.pauseOnConnect);
  assert.strictEqual(server.allowHalfOpen, false);
  assert.strictEqual(server.pauseOnConnect, false);

  server.listen(0, common.mustCall(() => {
    console.log('Server listening on port:', server.address().port);
    const socket = tls.connect({
      port: server.address().port,
      rejectUnauthorized: false
    }, common.mustCall(() => {
      console.log('Client connected');
      socket.end();
    }));

    socket.on('close', () => {
      console.log('Client socket closed');
      server.close();
    });
  }));
}

{
  console.log('\nTest case 2: Custom options');
  const server = tls.createServer({
    allowHalfOpen: true,
    pauseOnConnect: true,
    ...options
  }, common.mustCall((socket) => {
    console.log('Server socket created with custom options');
    console.log('socket.allowHalfOpen:', socket.allowHalfOpen);
    console.log('socket.isPaused():', socket.isPaused());
    assert.strictEqual(socket.allowHalfOpen, true);
    assert.strictEqual(socket.isPaused(), true);
    socket.on('end', socket.end);
  }));

  console.log('Server custom options:');
  console.log('server.allowHalfOpen:', server.allowHalfOpen);
  console.log('server.pauseOnConnect:', server.pauseOnConnect);
  assert.strictEqual(server.allowHalfOpen, true);
  assert.strictEqual(server.pauseOnConnect, true);

  server.listen(0, common.mustCall(() => {
    console.log('Server listening on port:', server.address().port);
    const socket = tls.connect({
      port: server.address().port,
      rejectUnauthorized: false
    }, common.mustCall(() => {
      console.log('Client connected');
      socket.end();
    }));

    socket.on('close', () => {
      console.log('Client socket closed');
      server.close();
    });
  }));
}
