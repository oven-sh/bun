//#FILE: test-http2-perf_hooks.js
//#SHA1: a759a55527c8587bdf272da00c6597d93aa36da0
//-----------------
'use strict';

const h2 = require('http2');
const { PerformanceObserver } = require('perf_hooks');

let server;
let client;

beforeAll(() => {
  if (!process.versions.openssl) {
    return test.skip('missing crypto');
  }
});

afterEach(() => {
  if (client) client.close();
  if (server) server.close();
});

test('HTTP/2 performance hooks', (done) => {
  const obs = new PerformanceObserver((items) => {
    const entry = items.getEntries()[0];
    expect(entry.entryType).toBe('http2');
    expect(typeof entry.startTime).toBe('number');
    expect(typeof entry.duration).toBe('number');
    
    switch (entry.name) {
      case 'Http2Session':
        expect(typeof entry.pingRTT).toBe('number');
        expect(typeof entry.streamAverageDuration).toBe('number');
        expect(typeof entry.streamCount).toBe('number');
        expect(typeof entry.framesReceived).toBe('number');
        expect(typeof entry.framesSent).toBe('number');
        expect(typeof entry.bytesWritten).toBe('number');
        expect(typeof entry.bytesRead).toBe('number');
        expect(typeof entry.maxConcurrentStreams).toBe('number');
        expect(typeof entry.detail.pingRTT).toBe('number');
        expect(typeof entry.detail.streamAverageDuration).toBe('number');
        expect(typeof entry.detail.streamCount).toBe('number');
        expect(typeof entry.detail.framesReceived).toBe('number');
        expect(typeof entry.detail.framesSent).toBe('number');
        expect(typeof entry.detail.bytesWritten).toBe('number');
        expect(typeof entry.detail.bytesRead).toBe('number');
        expect(typeof entry.detail.maxConcurrentStreams).toBe('number');
        switch (entry.type) {
          case 'server':
            expect(entry.detail.streamCount).toBe(1);
            expect(entry.detail.framesReceived).toBeGreaterThanOrEqual(3);
            break;
          case 'client':
            expect(entry.detail.streamCount).toBe(1);
            expect(entry.detail.framesReceived).toBe(7);
            break;
          default:
            fail('invalid Http2Session type');
        }
        break;
      case 'Http2Stream':
        expect(typeof entry.timeToFirstByte).toBe('number');
        expect(typeof entry.timeToFirstByteSent).toBe('number');
        expect(typeof entry.timeToFirstHeader).toBe('number');
        expect(typeof entry.bytesWritten).toBe('number');
        expect(typeof entry.bytesRead).toBe('number');
        expect(typeof entry.detail.timeToFirstByte).toBe('number');
        expect(typeof entry.detail.timeToFirstByteSent).toBe('number');
        expect(typeof entry.detail.timeToFirstHeader).toBe('number');
        expect(typeof entry.detail.bytesWritten).toBe('number');
        expect(typeof entry.detail.bytesRead).toBe('number');
        break;
      default:
        fail('invalid entry name');
    }
  });

  obs.observe({ type: 'http2' });

  const body = '<html><head></head><body><h1>this is some data</h2></body></html>';

  server = h2.createServer();

  server.on('stream', (stream, headers, flags) => {
    expect(headers[':scheme']).toBe('http');
    expect(headers[':authority']).toBeTruthy();
    expect(headers[':method']).toBe('GET');
    expect(flags).toBe(5);
    stream.respond({
      'content-type': 'text/html',
      ':status': 200
    });
    stream.write(body.slice(0, 20));
    stream.end(body.slice(20));
  });

  server.on('session', (session) => {
    session.ping(jest.fn());
  });

  server.listen(0, () => {
    client = h2.connect(`http://localhost:${server.address().port}`);

    client.on('connect', () => {
      client.ping(jest.fn());
    });

    const req = client.request();

    req.on('response', jest.fn());

    let data = '';
    req.setEncoding('utf8');
    req.on('data', (d) => data += d);
    req.on('end', () => {
      expect(body).toBe(data);
    });
    req.on('close', () => {
      obs.disconnect();
      done();
    });
  });
});
//<#END_FILE: test-http2-perf_hooks.js
