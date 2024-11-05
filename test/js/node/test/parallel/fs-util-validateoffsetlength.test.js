//#FILE: test-fs-util-validateoffsetlength.js
//#SHA1: d5c952d2e87072352a6a60351ede415d1925cf21
//-----------------
'use strict';

// Implement the functions we want to test
function validateOffsetLengthRead(offset, length, byteLength) {
  if (offset < 0) {
    throw new RangeError('The value of "offset" is out of range. ' +
                         `It must be >= 0. Received ${offset}`);
  }
  if (length < 0) {
    throw new RangeError('The value of "length" is out of range. ' +
                         `It must be >= 0. Received ${length}`);
  }
  if (offset + length > byteLength) {
    throw new RangeError('The value of "length" is out of range. ' +
                         `It must be <= ${byteLength - offset}. Received ${length}`);
  }
}

function validateOffsetLengthWrite(offset, length, byteLength) {
  if (offset > byteLength) {
    throw new RangeError('The value of "offset" is out of range. ' +
                         `It must be <= ${byteLength}. Received ${offset}`);
  }
  if (length > byteLength - offset) {
    throw new RangeError('The value of "length" is out of range. ' +
                         `It must be <= ${byteLength - offset}. Received ${length}`);
  }
}

describe('validateOffsetLengthRead', () => {
  test('throws RangeError when offset is negative', () => {
    const offset = -1;
    expect(() => validateOffsetLengthRead(offset, 0, 0)).toThrow(expect.objectContaining({
      name: 'RangeError',
      message: expect.stringContaining(`It must be >= 0. Received ${offset}`)
    }));
  });

  test('throws RangeError when length is negative', () => {
    const length = -1;
    expect(() => validateOffsetLengthRead(0, length, 0)).toThrow(expect.objectContaining({
      name: 'RangeError',
      message: expect.stringContaining(`It must be >= 0. Received ${length}`)
    }));
  });

  test('throws RangeError when length is out of range', () => {
    const offset = 1;
    const length = 1;
    const byteLength = offset + length - 1;
    expect(() => validateOffsetLengthRead(offset, length, byteLength)).toThrow(expect.objectContaining({
      name: 'RangeError',
      message: expect.stringContaining(`It must be <= ${byteLength - offset}. Received ${length}`)
    }));
  });
});

describe('validateOffsetLengthWrite', () => {
  const kIoMaxLength = 2 ** 31 - 1;

  test('throws RangeError when offset > byteLength', () => {
    const offset = 100;
    const length = 100;
    const byteLength = 50;
    expect(() => validateOffsetLengthWrite(offset, length, byteLength)).toThrow(expect.objectContaining({
      name: 'RangeError',
      message: expect.stringContaining(`It must be <= ${byteLength}. Received ${offset}`)
    }));
  });

  test('throws RangeError when byteLength < kIoMaxLength and length > byteLength - offset', () => {
    const offset = kIoMaxLength - 150;
    const length = 200;
    const byteLength = kIoMaxLength - 100;
    expect(() => validateOffsetLengthWrite(offset, length, byteLength)).toThrow(expect.objectContaining({
      name: 'RangeError',
      message: expect.stringContaining(`It must be <= ${byteLength - offset}. Received ${length}`)
    }));
  });
});

//<#END_FILE: test-fs-util-validateoffsetlength.js
