'use strict';
const common = require('../common');
const fixtures = require('../common/fixtures');

// Test directly created TLS sockets and options.

const assert = require('assert');
const {
  connect, keys, tls
} = require(fixtures.path('tls-connect'));

test(undefined, (err) => {
  console.log('Test 1 - Error code:', err.code);
  assert.strictEqual(err.code, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
});

test({}, (err) => {
  console.log('Test 2 - Error code:', err.code);
  assert.strictEqual(err.code, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
});

test(
  { secureContext: tls.createSecureContext({ ca: keys.agent1.ca }) },
  (err) => { 
    console.log('Test 3 - Error:', err);
    assert.ifError(err); 
  });

test(
  { ca: keys.agent1.ca },
  (err) => { 
    console.log('Test 4 - Error:', err);
    assert.ifError(err); 
  });

// Secure context options, like ca, are ignored if a sec ctx is explicitly
// provided.
test(
  { secureContext: tls.createSecureContext(), ca: keys.agent1.ca },
  (err) => {
    console.log('Test 5 - Error code:', err.code);
    assert.strictEqual(err.code,
                       'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  });

function test(client, callback) {
  console.log('Starting test with client options:', client);
  callback = common.mustCall(callback);
  connect({
    server: {
      key: keys.agent1.key,
      cert: keys.agent1.cert,
    },
  }, function(err, pair, cleanup) {
    console.log('Connection error:', err);
    assert.strictEqual(err.code, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    let recv = '';
    pair.server.server.once('secureConnection', common.mustCall((conn) => {
      console.log('Secure connection established');
      conn.on('data', (data) => {
        console.log('Received data:', data.toString());
        recv += data;
      });
      conn.on('end', common.mustCall(() => {
        console.log('Connection ended, received:', recv);
        // Server sees nothing wrong with connection, even though the client's
        // authentication of the server cert failed.
        assert.strictEqual(recv, 'hello');
        cleanup();
      }));
    }));

    // `new TLSSocket` doesn't support the 'secureConnect' event on client side,
    // and doesn't error if authentication failed. Caller must explicitly check
    // for failure.
    const socket = new tls.TLSSocket(null, client);
    console.log('Created new TLSSocket');
    socket.connect(pair.server.server.address().port)
      .on('connect', common.mustCall(function() {
        console.log('Socket connected');
        this.end('hello');
      }))
      .on('secure', common.mustCall(function() {
        console.log('Socket secure, verify error:', this.ssl.verifyError());
        callback(this.ssl.verifyError());
      }));
  });
}
