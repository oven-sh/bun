//#FILE: test-fs-buffertype-writesync.js
//#SHA1: 6af4aca43ae7299ed310d17733db6dcc43d0ed2b
//-----------------
'use strict';
const fs = require('fs');

test('fs.writeSync throws for invalid data input', () => {
  const invalidInputs = [
    true, false, 0, 1, Infinity, () => {}, {}, [], undefined, null,
  ];

  invalidInputs.forEach((value) => {
    expect(() => fs.writeSync(1, value)).toThrow(expect.objectContaining({
      message: expect.stringMatching(/"buffer"/),
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError'
    }));
  });
});

//<#END_FILE: test-fs-buffertype-writesync.js
