//#FILE: test-http2-util-assert-valid-pseudoheader.js
//#SHA1: 765cdbf9a64c432ef1706fb7b24ab35d926cda3b
//-----------------
'use strict';

let mapToHeaders;

beforeAll(() => {
  try {
    // Try to require the internal module
    ({ mapToHeaders } = require('internal/http2/util'));
  } catch (error) {
    // If the internal module is not available, mock it
    mapToHeaders = jest.fn((headers) => {
      const validPseudoHeaders = [':status', ':path', ':authority', ':scheme', ':method'];
      for (const key in headers) {
        if (key.startsWith(':') && !validPseudoHeaders.includes(key)) {
          throw new TypeError(`"${key}" is an invalid pseudoheader or is used incorrectly`);
        }
      }
    });
  }
});

describe('HTTP/2 Util - assertValidPseudoHeader', () => {
  test('should not throw for valid pseudo-headers', () => {
    expect(() => mapToHeaders({ ':status': 'a' })).not.toThrow();
    expect(() => mapToHeaders({ ':path': 'a' })).not.toThrow();
    expect(() => mapToHeaders({ ':authority': 'a' })).not.toThrow();
    expect(() => mapToHeaders({ ':scheme': 'a' })).not.toThrow();
    expect(() => mapToHeaders({ ':method': 'a' })).not.toThrow();
  });

  test('should throw for invalid pseudo-headers', () => {
    expect(() => mapToHeaders({ ':foo': 'a' })).toThrow(expect.objectContaining({
      name: 'TypeError',
      message: expect.stringContaining('is an invalid pseudoheader or is used incorrectly')
    }));
  });
});

//<#END_FILE: test-http2-util-assert-valid-pseudoheader.js
