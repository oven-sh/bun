//#FILE: test-stream-add-abort-signal.js
//#SHA1: 8caf14dd370aac5a01fad14026a78e1994dd3e4e
//-----------------
'use strict';

const { addAbortSignal, Readable } = require('stream');

describe('Stream addAbortSignal', () => {
  test('throws for invalid signal', () => {
    expect(() => {
      addAbortSignal('INVALID_SIGNAL');
    }).toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: expect.any(String)
    }));
  });

  test('throws for invalid stream', () => {
    const ac = new AbortController();
    expect(() => {
      addAbortSignal(ac.signal, 'INVALID_STREAM');
    }).toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: expect.any(String)
    }));
  });

  test('addAbortSignal returns the stream for valid signal and stream', () => {
    const ac = new AbortController();
    const r = new Readable({
      read: () => {},
    });
    const result = addAbortSignal(ac.signal, r);
    expect(result).toBe(r);
  });
});

//<#END_FILE: test-stream-add-abort-signal.js
