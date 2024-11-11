//#FILE: test-stream-readable-default-encoding.js
//#SHA1: 47ee4ab2e0c3eb851a4b74ed23d6b074b866380e
//-----------------
'use strict';
const { Readable } = require('stream');

test('Readable stream with invalid default encoding', () => {
  expect(() => {
    new Readable({
      read: () => {},
      defaultEncoding: 'my invalid encoding',
    });
  }).toThrow(expect.objectContaining({
    code: 'ERR_UNKNOWN_ENCODING',
  }));
});

test('Readable stream with hex default encoding', (done) => {
  const r = new Readable({
    read() {},
    defaultEncoding: 'hex'
  });

  r.push('ab');

  const dataHandler = jest.fn((chunk) => {
    expect(chunk.toString('hex')).toBe('ab');
  });

  r.on('data', dataHandler);

  r.on('end', () => {
    expect(dataHandler).toHaveBeenCalledTimes(1);
    done();
  });

  r.push(null); // Signal the end of the stream
});

test('Readable stream with hex default encoding and utf-8 push', (done) => {
  const r = new Readable({
    read() {},
    defaultEncoding: 'hex',
  });

  r.push('xy', 'utf-8');

  const dataHandler = jest.fn((chunk) => {
    expect(chunk.toString('utf-8')).toBe('xy');
  });

  r.on('data', dataHandler);

  r.on('end', () => {
    expect(dataHandler).toHaveBeenCalledTimes(1);
    done();
  });

  r.push(null); // Signal the end of the stream
});

//<#END_FILE: test-stream-readable-default-encoding.js
