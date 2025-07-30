'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const assert = require('assert');
const http2 = require('http2');
const { PADDING_STRATEGY_ALIGNED, PADDING_STRATEGY_CALLBACK } = http2.constants;
const { duplexPair } = require('stream');

{
  const testData = '<h1>Hello World.</h1>'; // 21 should generate 24 bytes data
  const server = http2.createServer({
    paddingStrategy: PADDING_STRATEGY_ALIGNED
  });
  server.on('stream', common.mustCall((stream, headers) => {
    stream.respond({
      'content-type': 'text/html',
      ':status': 200
    });
    stream.end(testData);
  }));

  const [ clientSide, serverSide ] = duplexPair();

// The lengths of the expected writes... note that this is highly
// sensitive to how the internals are implemented and may differ from node.js due to corking and settings.

// 45 is the settings frame (9 + 36)
// 9 + 9 + 40 are settings ACK window update and byte frames
// 24 is the data (divisible by 8 because of padding)
// 9 is the end of the stream
const clientLengths = [45, 9, 9, 40, 9, 24, 9];


// 45 for settings (9 + 36)
// 15 for headers and frame bytes
// 24 for data (divisible by 8 because of padding)
// 9 for ending the stream because we did in 2 steps (request + end)
const serverLengths = [93, 9];

  server.emit('connection', serverSide);

  const client = http2.connect('http://127.0.0.1:80', {
    paddingStrategy: PADDING_STRATEGY_ALIGNED,
    createConnection: common.mustCall(() => clientSide)
  });

  serverSide.on('data', common.mustCall((chunk) => {
    assert.strictEqual(chunk.length, serverLengths.shift());
  }, serverLengths.length));
  clientSide.on('data', common.mustCall((chunk) => {
    assert.strictEqual(chunk.length, clientLengths.shift());
  }, clientLengths.length));

  const req = client.request({ ':path': '/a' });

  req.on('response', common.mustCall());

  req.setEncoding('utf8');
  req.on('data', common.mustCall((data) => {
    assert.strictEqual(data, testData);
  }));
  req.on('close', common.mustCall(() => {
    clientSide.destroy();
    clientSide.end();
  }));
  req.end();
}

// PADDING_STRATEGY_CALLBACK has been aliased to mean aligned padding.
assert.strictEqual(PADDING_STRATEGY_ALIGNED, PADDING_STRATEGY_CALLBACK);
