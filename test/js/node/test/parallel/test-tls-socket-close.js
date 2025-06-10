'use strict';
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const net = require('net');
const Countdown = require('../common/countdown');
const fixtures = require('../common/fixtures');

const key = fixtures.readKey('agent2-key.pem');
const cert = fixtures.readKey('agent2-cert.pem');

let serverTlsSocket;
const tlsServer = tls.createServer({ cert, key }, (socket) => {
  console.log('TLS server received connection');
  serverTlsSocket = socket;
  socket.on('data', (chunk) => {
    console.log('TLS server received data:', chunk[0]);
    assert.strictEqual(chunk[0], 46);
    socket.write('.');
  });
  socket.on('close', () => {
    console.log('TLS server socket closed');
    dec();
  });
});

// A plain net server, that manually passes connections to the TLS
// server to be upgraded.
let netSocket;
let netSocketCloseEmitted = false;
const netServer = net.createServer((socket) => {
  console.log('Net server received connection');
  netSocket = socket;
  tlsServer.emit('connection', socket);
  socket.on('close', common.mustCall(() => {
    console.log('Net socket closed');
    netSocketCloseEmitted = true;
    assert.strictEqual(serverTlsSocket.destroyed, true);
  }));
}).listen(0, common.mustCall(() => {
  console.log('Net server listening on port:', netServer.address().port);
  connectClient(netServer);
}));

const countdown = new Countdown(2, () => {
  console.log('Countdown finished, closing net server');
  netServer.close();
});

// A client that connects, sends one message, and closes the raw connection:
function connectClient(server) {
  console.log('Connecting client');
  const clientTlsSocket = tls.connect({
    host: 'localhost',
    port: server.address().port,
    rejectUnauthorized: false
  });

  clientTlsSocket.write('.');

  clientTlsSocket.on('data', (chunk) => {
    console.log('Client received data:', chunk[0]);
    assert.strictEqual(chunk[0], 46);

    console.log('Destroying net socket');
    netSocket.destroy();
    assert.strictEqual(netSocket.destroyed, true);

    setImmediate(() => {
      console.log('Checking socket states in setImmediate:');
      console.log('netSocketCloseEmitted:', netSocketCloseEmitted);
      console.log('serverTlsSocket.destroyed:', serverTlsSocket.destroyed);
      // Close callbacks are executed after `setImmediate()` callbacks.
      assert.strictEqual(netSocketCloseEmitted, false);
      assert.strictEqual(serverTlsSocket.destroyed, false);
    });
  });

  clientTlsSocket.on('close', () => {
    console.log('Client socket closed');
    dec();
  });
}

function dec() {
  console.log('Decrementing countdown');
  countdown.dec();
}
