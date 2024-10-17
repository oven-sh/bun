//#FILE: test-http2-compat-write-early-hints.js
//#SHA1: 0ed18263958421cde07c37b8ec353005b7477499
//-----------------
'use strict';

const http2 = require('node:http2');
const util = require('node:util');
const debug = util.debuglog('test');

const testResBody = 'response content';

describe('HTTP/2 Early Hints', () => {
  test('Happy flow - string argument', async () => {
    const server = http2.createServer();

    server.on('request', (req, res) => {
      debug('Server sending early hints...');
      res.writeEarlyHints({
        link: '</styles.css>; rel=preload; as=style'
      });

      debug('Server sending full response...');
      res.end(testResBody);
    });

    await new Promise(resolve => server.listen(0, resolve));

    const client = http2.connect(`http://localhost:${server.address().port}`);
    const req = client.request();

    debug('Client sending request...');

    await new Promise(resolve => {
      req.on('headers', (headers) => {
        expect(headers).toBeDefined();
        expect(headers[':status']).toBe(103);
        expect(headers.link).toBe('</styles.css>; rel=preload; as=style');
      });

      req.on('response', (headers) => {
        expect(headers[':status']).toBe(200);
      });

      let data = '';
      req.on('data', (d) => data += d);

      req.on('end', () => {
        debug('Got full response.');
        expect(data).toBe(testResBody);
        client.close();
        server.close(resolve);
      });
    });
  });

  test('Happy flow - array argument', async () => {
    const server = http2.createServer();

    server.on('request', (req, res) => {
      debug('Server sending early hints...');
      res.writeEarlyHints({
        link: [
          '</styles.css>; rel=preload; as=style',
          '</scripts.js>; rel=preload; as=script',
        ]
      });

      debug('Server sending full response...');
      res.end(testResBody);
    });

    await new Promise(resolve => server.listen(0, resolve));

    const client = http2.connect(`http://localhost:${server.address().port}`);
    const req = client.request();

    debug('Client sending request...');

    await new Promise(resolve => {
      req.on('headers', (headers) => {
        expect(headers).toBeDefined();
        expect(headers[':status']).toBe(103);
        expect(headers.link).toBe(
          '</styles.css>; rel=preload; as=style, </scripts.js>; rel=preload; as=script'
        );
      });

      req.on('response', (headers) => {
        expect(headers[':status']).toBe(200);
      });

      let data = '';
      req.on('data', (d) => data += d);

      req.on('end', () => {
        debug('Got full response.');
        expect(data).toBe(testResBody);
        client.close();
        server.close(resolve);
      });
    });
  });

  test('Happy flow - empty array', async () => {
    const server = http2.createServer();

    server.on('request', (req, res) => {
      debug('Server sending early hints...');
      res.writeEarlyHints({
        link: []
      });

      debug('Server sending full response...');
      res.end(testResBody);
    });

    await new Promise(resolve => server.listen(0, resolve));

    const client = http2.connect(`http://localhost:${server.address().port}`);
    const req = client.request();

    debug('Client sending request...');

    await new Promise(resolve => {
      const headersListener = jest.fn();
      req.on('headers', headersListener);

      req.on('response', (headers) => {
        expect(headers[':status']).toBe(200);
        expect(headersListener).not.toHaveBeenCalled();
      });

      let data = '';
      req.on('data', (d) => data += d);

      req.on('end', () => {
        debug('Got full response.');
        expect(data).toBe(testResBody);
        client.close();
        server.close(resolve);
      });
    });
  });
});

//<#END_FILE: test-http2-compat-write-early-hints.js
