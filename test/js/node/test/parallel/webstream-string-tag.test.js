//#FILE: test-webstream-string-tag.js
//#SHA1: 53f13b84555ff37eeee23ca4552540d76b88c2ad
//-----------------
"use strict";

test("Web Stream classes have correct Symbol.toStringTag", () => {
  const classesToBeTested = [
    WritableStream,
    WritableStreamDefaultWriter,
    WritableStreamDefaultController,
    ReadableStream,
    ReadableStreamBYOBRequest,
    ReadableStreamDefaultReader,
    ReadableStreamBYOBReader,
    ReadableStreamDefaultController,
    ReadableByteStreamController,
    ByteLengthQueuingStrategy,
    CountQueuingStrategy,
    TransformStream,
    TransformStreamDefaultController,
  ];

  classesToBeTested.forEach(cls => {
    expect(cls.prototype[Symbol.toStringTag]).toBe(cls.name);
    expect(Object.getOwnPropertyDescriptor(cls.prototype, Symbol.toStringTag)).toEqual({
      configurable: true,
      enumerable: false,
      value: cls.name,
      writable: false,
    });
  });
});

//<#END_FILE: test-webstream-string-tag.js
