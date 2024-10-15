//#FILE: test-http2-compat-client-upload-reject.js
//#SHA1: 4dff98612ac613af951070f79f07f5c1750045da
//-----------------
'use strict';

const http2 = require('http2');
const fs = require('fs');
const path = require('path');

const fixturesPath = path.resolve(__dirname, '..', 'fixtures');
const loc = path.join(fixturesPath, 'person-large.jpg');

let server;
let client;

beforeAll(() => {
  if (!process.versions.openssl) {
    return test.skip('missing crypto');
  }
});

afterEach(() => {
  if (server) server.close();
  if (client) client.close();
});

test('HTTP/2 client upload reject', (done) => {
  expect(fs.existsSync(loc)).toBe(true);

  fs.readFile(loc, (err, data) => {
    expect(err).toBeNull();

    server = http2.createServer((req, res) => {
      setImmediate(() => {
        res.writeHead(400);
        res.end();
      });
    });

    server.listen(0, () => {
      const port = server.address().port;
      client = http2.connect(`http://localhost:${port}`);

      const req = client.request({ ':method': 'POST' });
      req.on('response', (headers) => {
        expect(headers[':status']).toBe(400);
      });

      req.resume();
      req.on('end', () => {
        server.close();
        client.close();
        done();
      });

      const str = fs.createReadStream(loc);
      str.pipe(req);
    });
  });
});

//<#END_FILE: test-http2-compat-client-upload-reject.js
