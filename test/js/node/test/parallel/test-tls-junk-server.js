'use strict';
const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const https = require('https');
const net = require('net');

console.log('Starting TLS junk server test');

const server = net.createServer(function(s) {
  console.log('Server received connection');
  s.once('data', function() {
    console.log('Server received data');
    s.end('I was waiting for you, hello!', function() {
      console.log('Server sent response');
      s.destroy();
    });
  });
});

server.listen(0, function() {
  console.log('Server listening on port:', this.address().port);
  const req = https.request({ port: this.address().port });
  req.end();
  console.log('HTTPS request sent');

  let expectedErrorMessage = new RegExp('wrong version number');
  if (common.hasOpenSSL(3, 2)) {
    console.log('Using OpenSSL 3.2+ error message pattern');
    expectedErrorMessage = new RegExp('packet length too long');
  }
  req.once('error', common.mustCall(function(err) {
    console.log('Received error:', err.message);
    assert(expectedErrorMessage.test(err.message));
    server.close();
    console.log('Test completed');
  }));
});
