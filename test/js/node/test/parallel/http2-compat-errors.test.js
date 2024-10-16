//#FILE: test-http2-compat-errors.js
//#SHA1: 3a958d2216c02d05272fbc89bd09a532419876a4
//-----------------
'use strict';

const h2 = require('http2');

// Simulate crypto check
const hasCrypto = true;
if (!hasCrypto) {
  test.skip('missing crypto', () => {});
} else {
  let expected = null;

  describe('http2 compat errors', () => {
    let server;
    let url;

    beforeAll((done) => {
      server = h2.createServer((req, res) => {
        const resStreamErrorHandler = jest.fn();
        const reqErrorHandler = jest.fn();
        const resErrorHandler = jest.fn();
        const reqAbortedHandler = jest.fn();
        const resAbortedHandler = jest.fn();

        res.stream.on('error', resStreamErrorHandler);
        req.on('error', reqErrorHandler);
        res.on('error', resErrorHandler);
        req.on('aborted', reqAbortedHandler);
        res.on('aborted', resAbortedHandler);

        res.write('hello');

        expected = new Error('kaboom');
        res.stream.destroy(expected);

        // Use setImmediate to allow event handlers to be called
        setImmediate(() => {
          expect(resStreamErrorHandler).toHaveBeenCalled();
          expect(reqErrorHandler).not.toHaveBeenCalled();
          expect(resErrorHandler).not.toHaveBeenCalled();
          expect(reqAbortedHandler).toHaveBeenCalled();
          expect(resAbortedHandler).not.toHaveBeenCalled();
          server.close(done);
        });
      });

      server.listen(0, () => {
        url = `http://localhost:${server.address().port}`;
        done();
      });
    });

    test('should handle errors correctly', (done) => {
      const client = h2.connect(url, () => {
        const request = client.request();
        request.on('data', (chunk) => {
          client.destroy();
          done();
        });
      });
    });
  });
}

//<#END_FILE: test-http2-compat-errors.js
