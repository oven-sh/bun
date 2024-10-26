//#FILE: test-stream-writableState-ending.js
//#SHA1: 97f5685bff2d1c4507caed842006d83c7317e0c0
//-----------------
'use strict';

const stream = require('stream');

function testStates(writable, ending, finished, ended) {
  expect(writable._writableState.ending).toBe(ending);
  expect(writable._writableState.finished).toBe(finished);
  expect(writable._writableState.ended).toBe(ended);
}

test('Writable stream state during ending process', (done) => {
  const writable = new stream.Writable();

  writable._write = (chunk, encoding, cb) => {
    // Ending, finished, ended start in false.
    testStates(writable, false, false, false);
    cb();
  };

  writable.on('finish', () => {
    // Ending, finished, ended = true.
    testStates(writable, true, true, true);
    done();
  });

  const result = writable.end('testing function end()', () => {
    // Ending, finished, ended = true.
    testStates(writable, true, true, true);
  });

  // End returns the writable instance
  expect(result).toBe(writable);

  // Ending, ended = true.
  // finished = false.
  testStates(writable, true, false, true);
});

//<#END_FILE: test-stream-writableState-ending.js
