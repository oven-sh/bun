// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const fixtures = require('../common/fixtures');

const assert = require('assert');
const tls = require('tls');
const net = require('net');

console.log('Loading certificates...');
const options = {
  key: fixtures.readKey('rsa_private.pem'),
  cert: fixtures.readKey('rsa_cert.crt')
};
console.log('Certificates loaded successfully');

const server = tls.createServer(options, common.mustCall((socket) => {
  console.log('Server received connection');
  socket.end('Hello');
}, 2)).listen(0, common.mustCall(() => {
  console.log('Server listening on port:', server.address().port);
  let waiting = 2;
  function establish(socket, calls) {
    console.log('Establishing TLS connection with socket');
    const client = tls.connect({
      rejectUnauthorized: false,
      socket: socket
    }, common.mustCall(() => {
      console.log('TLS connection established');
      let data = '';
      client.on('data', common.mustCall((chunk) => {
        console.log('Client received data chunk');
        data += chunk.toString();
      }));
      client.on('end', common.mustCall(() => {
        console.log('Client connection ended');
        assert.strictEqual(data, 'Hello');
        if (--waiting === 0) {
          console.log('All connections completed, closing server');
          server.close();
        }
      }));
    }, calls));
    assert(client.readable);
    assert(client.writable);
    console.log('Client socket is readable and writable');

    return client;
  }

  const { port } = server.address();

  // Immediate death socket
  console.log('Creating immediate death socket');
  const immediateDeath = net.connect(port);
  establish(immediateDeath, 0).destroy();
  console.log('Immediate death socket destroyed');

  // Outliving
  console.log('Creating outliving TCP connection');
  const outlivingTCP = net.connect(port, common.mustCall(() => {
    console.log('Outliving TCP connected, destroying TLS');
    outlivingTLS.destroy();
    next();
  }));
  const outlivingTLS = establish(outlivingTCP, 0);

  function next() {
    console.log('Starting next connection phase');
    // Already connected socket
    const connected = net.connect(port, common.mustCall(() => {
      console.log('Connected socket ready, establishing TLS');
      establish(connected);
    }));

    // Connecting socket
    console.log('Creating connecting socket');
    const connecting = net.connect(port);
    establish(connecting);
  }
}));
