'use strict';
const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const tls = require('tls');
const net = require('net');
const assert = require('assert');

const bonkers = Buffer.alloc(1024, 42);

const server = net.createServer(function(c) {
  console.log('Server: New connection received');
  setTimeout(function() {
    console.log('Server: Creating TLSSocket');
    const s = new tls.TLSSocket(c, {
      isServer: true,
      server: server
    });

    s.on('error', common.mustCall(function(e) {
      console.log('Server: Error received:', e.message);
      assert.ok(e instanceof Error,
                'Instance of Error should be passed to error handler');
      assert.ok(
        /SSL routines:[^:]*:wrong version number/.test(
          e.message),
        'Expecting SSL unknown protocol');
    }));

    s.on('close', function() {
      console.log('Server: Connection closed');
      server.close();
      s.destroy();
    });
  }, common.platformTimeout(200));
}).listen(0, function() {
  console.log('Server: Listening on port', this.address().port);
  const c = net.connect({ port: this.address().port }, function() {
    console.log('Client: Connected, writing bonkers data');
    c.write(bonkers);
  });
});
