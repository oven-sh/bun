//#FILE: test-http2-client-write-empty-string.js
//#SHA1: d4371ceba660942fe3c398bbb3144ce691054cec
//-----------------
'use strict';

const http2 = require('http2');

const runTest = async (chunkSequence) => {
  return new Promise((resolve, reject) => {
    const server = http2.createServer();
    server.on('stream', (stream, headers, flags) => {
      stream.respond({ 'content-type': 'text/html' });

      let data = '';
      stream.on('data', (chunk) => {
        data += chunk.toString();
      });
      stream.on('end', () => {
        stream.end(`"${data}"`);
      });
    });

    server.listen(0, async () => {
      const port = server.address().port;
      const client = http2.connect(`http://localhost:${port}`);

      const req = client.request({
        ':method': 'POST',
        ':path': '/'
      });

      req.on('response', (headers) => {
        expect(headers[':status']).toBe(200);
        expect(headers['content-type']).toBe('text/html');
      });

      let data = '';
      req.setEncoding('utf8');
      req.on('data', (d) => data += d);
      req.on('end', () => {
        expect(data).toBe('""');
        server.close();
        client.close();
        resolve();
      });

      for (const chunk of chunkSequence) {
        req.write(chunk);
      }
      req.end();
    });
  });
};

const testCases = [
  [''],
  ['', '']
];

describe('http2 client write empty string', () => {
  beforeAll(() => {
    if (typeof http2 === 'undefined') {
      return test.skip('http2 module not available');
    }
  });

  testCases.forEach((chunkSequence, index) => {
    it(`should handle chunk sequence ${index + 1}`, async () => {
      await runTest(chunkSequence);
    });
  });
});

//<#END_FILE: test-http2-client-write-empty-string.js
