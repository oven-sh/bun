'use strict';
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const assert = require('assert');
const fixtures = require('../common/fixtures');
const { duplexPair } = require('stream');
const tls = require('tls');
const net = require('net');

// This test ensures that `bufferSize` also works for those tlsSockets
// created from `socket` of `Duplex`, with which, TLSSocket will wrap
// sockets in `StreamWrap`.
{
  const iter = 10;
  console.log('Starting test with iter:', iter);

  function createDuplex(port) {
    console.log('Creating duplex pair for port:', port);
    const [ clientSide, serverSide ] = duplexPair();

    return new Promise((resolve, reject) => {
      const socket = net.connect({
        port,
      }, common.mustCall(() => {
        console.log('Socket connected, setting up pipes');
        clientSide.pipe(socket);
        socket.pipe(clientSide);
        clientSide.on('close', common.mustCall(() => {
          console.log('Client side closed, destroying socket');
          socket.destroy();
        }));
        socket.on('close', common.mustCall(() => {
          console.log('Socket closed, destroying client side');
          clientSide.destroy();
        }));

        resolve(serverSide);
      }));
    });
  }

  const server = tls.createServer({
    key: fixtures.readKey('agent2-key.pem'),
    cert: fixtures.readKey('agent2-cert.pem')
  }, common.mustCall((socket) => {
    console.log('Server received connection');
    let str = '';
    socket.setEncoding('utf-8');
    socket.on('data', (chunk) => { 
      console.log('Server received chunk:', chunk);
      str += chunk; 
    });

    socket.on('end', common.mustCall(() => {
      console.log('Server received end, str length:', str.length);
      assert.strictEqual(str, 'a'.repeat(iter - 1));
      server.close();
    }));
  }));

  server.listen(0, common.mustCall(() => {
    const { port } = server.address();
    console.log('Server listening on port:', port);
    createDuplex(port).then((socket) => {
      console.log('Duplex created, connecting TLS client');
      const client = tls.connect({
        socket,
        rejectUnauthorized: false,
      }, common.mustCall(() => {
        console.log('TLS client connected, initial bufferSize:', client.bufferSize);
        assert.strictEqual(client.bufferSize, 0);

        for (let i = 1; i < iter; i++) {
          client.write('a');
          console.log('Wrote data, bufferSize:', client.bufferSize);
          assert.strictEqual(client.bufferSize, i);
        }

        client.on('end', common.mustCall(() => {
          console.log('Client received end event');
        }));
        client.on('close', common.mustCall(() => {
          console.log('Client closed, final bufferSize:', client.bufferSize);
          assert.strictEqual(client.bufferSize, undefined);
        }));

        client.end();
      }));
    });
  }));
}
