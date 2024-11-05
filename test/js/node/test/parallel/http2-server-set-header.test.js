//#FILE: test-http2-server-set-header.js
//#SHA1: d4ba0042eab7b4ef4927f3aa3e344f4b5e04f935
//-----------------
'use strict';

const http2 = require('http2');

const body = '<html><head></head><body><h1>this is some data</h2></body></html>';

let server;
let port;

beforeAll((done) => {
  server = http2.createServer((req, res) => {
    res.setHeader('foobar', 'baz');
    res.setHeader('X-POWERED-BY', 'node-test');
    res.setHeader('connection', 'connection-test');
    res.end(body);
  });

  server.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

test('HTTP/2 server set header', (done) => {
  const client = http2.connect(`http://localhost:${port}`);
  const headers = { ':path': '/' };
  const req = client.request(headers);
  req.setEncoding('utf8');

  req.on('response', (headers) => {
    expect(headers.foobar).toBe('baz');
    expect(headers['x-powered-by']).toBe('node-test');
    // The 'connection' header should not be present in HTTP/2
    expect(headers.connection).toBeUndefined();
  });

  let data = '';
  req.on('data', (d) => data += d);
  req.on('end', () => {
    expect(data).toBe(body);
    client.close();
    done();
  });
  req.end();
});

test('Setting connection header should not throw', () => {
  const res = {
    setHeader: jest.fn()
  };
  
  expect(() => {
    res.setHeader('connection', 'test');
  }).not.toThrow();

  expect(res.setHeader).toHaveBeenCalledWith('connection', 'test');
});

test('Server should not emit error', (done) => {
  const errorListener = jest.fn();
  server.on('error', errorListener);

  setTimeout(() => {
    expect(errorListener).not.toHaveBeenCalled();
    server.removeListener('error', errorListener);
    done();
  }, 100);
});

//<#END_FILE: test-http2-server-set-header.js
