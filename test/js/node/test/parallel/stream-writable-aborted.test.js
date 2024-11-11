//#FILE: test-stream-writable-aborted.js
//#SHA1: be315bbc27ad16f13bb6b3022e864c8902265391
//-----------------
'use strict';

const { Writable } = require('stream');

describe('Writable Stream Aborted', () => {
  test('writable.destroy() should set writableAborted to true', () => {
    const writable = new Writable({
      write() {}
    });
    expect(writable.writableAborted).toBe(false);
    writable.destroy();
    expect(writable.writableAborted).toBe(true);
  });

  test('writable.end() followed by destroy() should set writableAborted to true', () => {
    const writable = new Writable({
      write() {}
    });
    expect(writable.writableAborted).toBe(false);
    writable.end();
    writable.destroy();
    expect(writable.writableAborted).toBe(true);
  });
});

//<#END_FILE: test-stream-writable-aborted.js
