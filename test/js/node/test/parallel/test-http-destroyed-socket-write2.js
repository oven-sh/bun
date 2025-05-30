const common = require('../common');

// Verify that ECONNRESET is raised when writing to a http request
// where the server has ended the socket.

const assert = require('assert');
const http = require('http');

const kResponseDestroyed = Symbol('kResponseDestroyed');

const server = http.createServer(function(req, res) {
  req.on('data', common.mustCall(function() {
    res.destroy();
    server.emit(kResponseDestroyed);
  }));
});

server.listen(0, function() {
  const req = http.request({
    port: this.address().port,
    path: '/',
    method: 'POST'
  });

  server.once(kResponseDestroyed, common.mustCall(function() {
    req.write('hello');
  }));

  req.on('error', common.mustCall(function(er) {
    assert.strictEqual(req.res, null);
    switch (er.code) {
      // This is the expected case
      case 'ECONNRESET':
        break;

      // On Windows, this sometimes manifests as ECONNABORTED
      case 'ECONNABORTED':
        break;

      // This test is timing sensitive so an EPIPE is not out of the question.
      // It should be infrequent, given the 50 ms timeout, but not impossible.
      case 'EPIPE':
        break;

      default:
        // Write to a torn down client should RESET or ABORT
        assert.fail(`Unexpected error code ${er.code}`);
    }

    assert.strictEqual(req.outputData.length, 0);
    server.close();
  }));

  req.on('response', common.mustNotCall());
  req.write('hello', common.mustSucceed());
});
