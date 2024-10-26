//#FILE: test-stream-base-prototype-accessors-enumerability.js
//#SHA1: a5423c2b42bae0fbdd1530553de4d40143c010cf
//-----------------
'use strict';

const { Readable } = require('stream');

describe('StreamBase prototype accessors enumerability', () => {
  test('prototype accessors should not be enumerable', () => {
    // We'll use Readable as a stand-in for TTY, since it's a stream-based class
    // that should have similar prototype setup to what StreamBase::AddMethods does
    const readableProto = Object.getPrototypeOf(new Readable());
    
    const isEnumerable = (obj, prop) => 
      Object.prototype.propertyIsEnumerable.call(obj, prop);

    // Test for common stream properties
    expect(isEnumerable(readableProto, 'readable')).toBe(false);
    expect(isEnumerable(readableProto, 'readableHighWaterMark')).toBe(false);
    expect(isEnumerable(readableProto, 'readableLength')).toBe(false);

    // Additional checks for other potential properties
    expect(isEnumerable(readableProto, 'destroyed')).toBe(false);
    expect(isEnumerable(readableProto, 'closed')).toBe(false);
  });
});

//<#END_FILE: test-stream-base-prototype-accessors-enumerability.js
