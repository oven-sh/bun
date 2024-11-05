//#FILE: test-http2-write-empty-string.js
//#SHA1: 59ba4a8a3c63aad827770d96f668922107ed2f2f
//-----------------
'use strict';

const http2 = require('http2');

// Skip the test if crypto is not available
let http2Server;
beforeAll(() => {
  if (!process.versions.openssl) {
    test.skip('missing crypto');
  }
});

afterAll(() => {
  if (http2Server) {
    http2Server.close();
  }
});

test('HTTP/2 server writes empty strings correctly', async () => {
  http2Server = http2.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write('1\n');
    response.write('');
    response.write('2\n');
    response.write('');
    response.end('3\n');
  });

  await new Promise(resolve => {
    http2Server.listen(0, resolve);
  });

  const port = http2Server.address().port;
  const client = http2.connect(`http://localhost:${port}`);
  const headers = { ':path': '/' };
  
  const responsePromise = new Promise((resolve, reject) => {
    const req = client.request(headers);
    
    let res = '';
    req.setEncoding('ascii');

    req.on('response', (headers) => {
      expect(headers[':status']).toBe(200);
    });

    req.on('data', (chunk) => {
      res += chunk;
    });

    req.on('end', () => {
      resolve(res);
    });

    req.on('error', reject);

    req.end();
  });

  const response = await responsePromise;
  expect(response).toBe('1\n2\n3\n');

  await new Promise(resolve => client.close(resolve));
});

//<#END_FILE: test-http2-write-empty-string.js
