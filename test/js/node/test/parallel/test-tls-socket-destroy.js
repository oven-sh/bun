'use strict';

const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const net = require('net');
const tls = require('tls');
const fixtures = require('../common/fixtures');

const key = fixtures.readKey('agent1-key.pem');
const cert = fixtures.readKey('agent1-cert.pem');

console.log('Creating secure context with key and cert');
const secureContext = tls.createSecureContext({ key, cert });

const server = net.createServer(common.mustCall((conn) => {
  console.log('Server received connection');
  const options = { isServer: true, secureContext, server };
  const socket = new tls.TLSSocket(conn, options);
  socket.once('data', common.mustCall(() => {
    console.log('Server received data, destroying SSL and socket');
    socket._destroySSL();  // Should not crash.
    socket.destroy();
    server.close();
  }));
}));

server.listen(0, function() {
  console.log('Server listening on port:', this.address().port);
  const options = {
    port: this.address().port,
    rejectUnauthorized: false,
  };
  tls.connect(options, function() {
    console.log('Client connected successfully');
    this.write('*'.repeat(1 << 20));  // Write more data than fits in a frame.
    console.log('Client wrote data');
    this.on('error', (err) => {
      console.log('Client received error:', err.message);
      this.destroy();
    });  // Server closes connection on us.
  });
});
