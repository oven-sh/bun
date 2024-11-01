//#FILE: test-http2-options-server-response.js
//#SHA1: 66736f340efdbdf2e20a79a3dffe75f499e65d89
//-----------------
'use strict';

const h2 = require('http2');

class MyServerResponse extends h2.Http2ServerResponse {
  status(code) {
    return this.writeHead(code, { 'Content-Type': 'text/plain' });
  }
}

let server;
let client;

beforeAll(() => {
  if (!process.versions.openssl) {
    return test.skip('missing crypto');
  }
});

afterAll(() => {
  if (server) server.close();
  if (client) client.destroy();
});

test('http2 server with custom ServerResponse', (done) => {
  server = h2.createServer({
    Http2ServerResponse: MyServerResponse
  }, (req, res) => {
    res.status(200);
    res.end();
  });

  server.listen(0, () => {
    const port = server.address().port;
    client = h2.connect(`http://localhost:${port}`);
    const req = client.request({ ':path': '/' });

    const responseHandler = jest.fn();
    req.on('response', responseHandler);

    const endHandler = jest.fn(() => {
      expect(responseHandler).toHaveBeenCalled();
      done();
    });

    req.resume();
    req.on('end', endHandler);
  });
});

//<#END_FILE: test-http2-options-server-response.js
