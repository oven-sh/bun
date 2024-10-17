//#FILE: test-http2-dont-override.js
//#SHA1: d295b8c4823cc34c03773eb08bf0393fca541694
//-----------------
'use strict';

const http2 = require('http2');

// Skip test if crypto is not available
if (!process.versions.openssl) {
  test.skip('missing crypto', () => {});
} else {
  test('http2 should not override options', (done) => {
    const options = {};

    const server = http2.createServer(options);

    // Options are defaulted but the options are not modified
    expect(Object.keys(options)).toEqual([]);

    server.on('stream', (stream) => {
      const headers = {};
      const options = {};
      stream.respond(headers, options);

      // The headers are defaulted but the original object is not modified
      expect(Object.keys(headers)).toEqual([]);

      // Options are defaulted but the original object is not modified
      expect(Object.keys(options)).toEqual([]);

      stream.end();
    });

    server.listen(0, () => {
      const client = http2.connect(`http://localhost:${server.address().port}`);

      const headers = {};
      const options = {};

      const req = client.request(headers, options);

      // The headers are defaulted but the original object is not modified
      expect(Object.keys(headers)).toEqual([]);

      // Options are defaulted but the original object is not modified
      expect(Object.keys(options)).toEqual([]);

      req.resume();
      req.on('end', () => {
        server.close();
        client.close();
        done();
      });
    });
  });
}

//<#END_FILE: test-http2-dont-override.js
