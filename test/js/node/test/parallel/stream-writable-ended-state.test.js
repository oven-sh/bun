//#FILE: test-stream-writable-ended-state.js
//#SHA1: e6a35fad059c742def91bd4cab4786faffa26f5b
//-----------------
'use strict';

const stream = require('stream');

test('Writable stream ended state', async () => {
  const writable = new stream.Writable();

  writable._write = (chunk, encoding, cb) => {
    expect(writable._writableState.ended).toBe(false);
    expect(writable._writableState.writable).toBeUndefined();
    expect(writable.writableEnded).toBe(false);
    cb();
  };

  expect(writable._writableState.ended).toBe(false);
  expect(writable._writableState.writable).toBeUndefined();
  expect(writable.writable).toBe(true);
  expect(writable.writableEnded).toBe(false);

  const endCallback = jest.fn();
  writable.end('testing ended state', endCallback);

  await new Promise(resolve => setImmediate(resolve));

  expect(endCallback).toHaveBeenCalled();
  expect(writable._writableState.ended).toBe(true);
  expect(writable._writableState.writable).toBeUndefined();
  expect(writable.writable).toBe(false);
  expect(writable.writableEnded).toBe(true);

  expect(writable._writableState.ended).toBe(true);
  expect(writable._writableState.writable).toBeUndefined();
  expect(writable.writable).toBe(false);
  expect(writable.writableEnded).toBe(true);
});

//<#END_FILE: test-stream-writable-ended-state.js
