//#FILE: test-http2-respond-file-filehandle.js
//#SHA1: c80cf9e1a4a879a73d275616e0604e56ac7756bb
//-----------------
'use strict';

const http2 = require('http2');
const fs = require('fs');
const path = require('path');

const {
  HTTP2_HEADER_CONTENT_TYPE,
  HTTP2_HEADER_CONTENT_LENGTH
} = http2.constants;

const fixturesPath = path.join(__dirname, '..', 'fixtures');
const fname = path.join(fixturesPath, 'elipses.txt');

test('http2 respond with file handle', async () => {
  // Skip test if running in Bun
  if (process.versions.bun) {
    return;
  }

  const data = await fs.promises.readFile(fname);
  const stat = await fs.promises.stat(fname);
  
  const fileHandle = await fs.promises.open(fname, 'r');
  
  const server = http2.createServer();
  server.on('stream', (stream) => {
    stream.respondWithFD(fileHandle, {
      [HTTP2_HEADER_CONTENT_TYPE]: 'text/plain',
      [HTTP2_HEADER_CONTENT_LENGTH]: stat.size,
    });
  });

  const serverCloseHandler = jest.fn();
  server.on('close', serverCloseHandler);

  await new Promise(resolve => server.listen(0, resolve));

  const client = http2.connect(`http://localhost:${server.address().port}`);
  const req = client.request();

  const responseHandler = jest.fn((headers) => {
    expect(headers[HTTP2_HEADER_CONTENT_TYPE]).toBe('text/plain');
    expect(Number(headers[HTTP2_HEADER_CONTENT_LENGTH])).toBe(data.length);
  });
  req.on('response', responseHandler);

  req.setEncoding('utf8');
  let check = '';
  req.on('data', (chunk) => check += chunk);

  await new Promise(resolve => {
    req.on('end', () => {
      expect(check).toBe(data.toString('utf8'));
      client.close();
      server.close();
      resolve();
    });
    req.end();
  });

  await new Promise(resolve => server.on('close', resolve));

  expect(responseHandler).toHaveBeenCalled();
  expect(serverCloseHandler).toHaveBeenCalled();

  await fileHandle.close();
});

//<#END_FILE: test-http2-respond-file-filehandle.js
