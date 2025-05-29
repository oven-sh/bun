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
const assert = require('assert');
const net = require('net');

// With only a callback, server should get a port assigned by the OS
{
  const server = net.createServer(common.mustNotCall());

  server.listen(
    common.mustCall(function () {
      assert.ok(server.address().port > 100);
      server.close();
    }),
  );
}

// No callback to listen(), assume we can bind in 100 ms
{
  const server = net.createServer(common.mustNotCall());

  server.listen(common.PORT);

  setTimeout(function () {
    const address = server.address();
    assert.strictEqual(address.port, common.PORT);

    if (address.family === 'IPv6')
      assert.strictEqual(server._connectionKey, `6::::${address.port}`);
    else assert.strictEqual(server._connectionKey, `4:0.0.0.0:${address.port}`);

    server.close();
  }, 100);
}

// Callback to listen()
{
  const server = net.createServer(common.mustNotCall());

  server.listen(
    common.PORT + 1,
    common.mustCall(function () {
      assert.strictEqual(server.address().port, common.PORT + 1);
      server.close();
    }),
  );
}

// Backlog argument
{
  const server = net.createServer(common.mustNotCall());

  server.listen(
    common.PORT + 2,
    '0.0.0.0',
    127,
    common.mustCall(function () {
      assert.strictEqual(server.address().port, common.PORT + 2);
      server.close();
    }),
  );
}

// Backlog argument without host argument
{
  const server = net.createServer(common.mustNotCall());

  server.listen(
    common.PORT + 3,
    127,
    common.mustCall(function () {
      assert.strictEqual(server.address().port, common.PORT + 3);
      server.close();
    }),
  );
}
