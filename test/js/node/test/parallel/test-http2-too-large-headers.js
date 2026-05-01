'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const http2 = require('http2');
const assert = require('assert');
const {
  NGHTTP2_ENHANCE_YOUR_CALM
} = http2.constants;

async function runTestForPrototype(prototype) {
  const server = http2.createServer({ settings: { [prototype]: 100 } });
  server.on('stream', common.mustNotCall());

  try {
    await new Promise((resolve, reject) => {
      server.listen(0, () => {
        const client = http2.connect(`http://localhost:${server.address().port}`);

        client.on('error', (err) => {
          client.close();
          server.close();
          reject(err);
        });

        client.on('remoteSettings', common.mustCall(() => {
          const req = client.request({ 'foo': 'a'.repeat(1000) });
          req.on('error', common.expectsError({
            code: 'ERR_HTTP2_STREAM_ERROR',
            name: 'Error',
            message: 'Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM'
          }));
          req.on('close', common.mustCall(() => {
            assert.strictEqual(req.rstCode, NGHTTP2_ENHANCE_YOUR_CALM);
            client.close();
            server.close();
            resolve();
          }));
        }));
      });

      server.on('error', reject);
    });
  } finally {
    if (server.listening) {
      server.close();
    }
  }
}

(async () => {
  for (const prototype of ['maxHeaderListSize', 'maxHeaderSize']) {
    await runTestForPrototype(prototype);
  }
})();
