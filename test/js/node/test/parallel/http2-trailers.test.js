//#FILE: test-http2-trailers.js
//#SHA1: 1e3d42d5008cf87fa8bf557b38f4fd00b4dbd712
//-----------------
'use strict';

const h2 = require('http2');

const body =
  '<html><head></head><body><h1>this is some data</h2></body></html>';
const trailerKey = 'test-trailer';
const trailerValue = 'testing';

let server;

beforeAll(() => {
  server = h2.createServer();
  server.on('stream', onStream);
});

afterAll(() => {
  server.close();
});

function onStream(stream, headers, flags) {
  stream.on('trailers', (headers) => {
    expect(headers[trailerKey]).toBe(trailerValue);
    stream.end(body);
  });
  stream.respond({
    'content-type': 'text/html',
    ':status': 200
  }, { waitForTrailers: true });
  stream.on('wantTrailers', () => {
    stream.sendTrailers({ [trailerKey]: trailerValue });
    expect(() => stream.sendTrailers({})).toThrow(expect.objectContaining({
      code: 'ERR_HTTP2_TRAILERS_ALREADY_SENT',
      name: 'Error'
    }));
  });

  expect(() => stream.sendTrailers({})).toThrow(expect.objectContaining({
    code: 'ERR_HTTP2_TRAILERS_NOT_READY',
    name: 'Error'
  }));
}

test('HTTP/2 trailers', (done) => {
  server.listen(0, () => {
    const client = h2.connect(`http://localhost:${server.address().port}`);
    const req = client.request({ ':path': '/', ':method': 'POST' },
                               { waitForTrailers: true });
    req.on('wantTrailers', () => {
      req.sendTrailers({ [trailerKey]: trailerValue });
    });
    req.on('data', () => {});
    req.on('trailers', (headers) => {
      expect(headers[trailerKey]).toBe(trailerValue);
    });
    req.on('close', () => {
      expect(() => req.sendTrailers({})).toThrow(expect.objectContaining({
        code: 'ERR_HTTP2_INVALID_STREAM',
        name: 'Error'
      }));
      client.close();
      done();
    });
    req.end('data');
  });
});

//<#END_FILE: test-http2-trailers.js
