//#FILE: test-fs-makeStatsCallback.js
//#SHA1: e8c59eddd5ca920ba0a1aaa4dd87c3af879db3b1
//-----------------
'use strict';
const fs = require('fs');

function testMakeStatsCallback(cb) {
  return function() {
    // fs.stat() calls makeStatsCallback() on its second argument
    fs.stat(__filename, cb);
  };
}

test('Verify the case where a callback function is provided', (done) => {
  testMakeStatsCallback(() => {
    done();
  })();
});

test('Invalid callback throws TypeError', () => {
  const callbackThrowValues = [null, true, false, 0, 1, 'foo', /foo/, [], {}];

  callbackThrowValues.forEach((value) => {
    expect(testMakeStatsCallback(value)).toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: expect.any(String)
    }));
  });
});

//<#END_FILE: test-fs-makeStatsCallback.js
