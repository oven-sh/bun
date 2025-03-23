//#FILE: test-fs-realpath-native.js
//#SHA1: add12c89cd17b16ae70ae1cfe943ce49157b2e68
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');

const filename = __filename.toLowerCase();

test('fs.realpathSync.native works correctly', () => {
  const result = fs.realpathSync.native(filename);
  expect(result.toLowerCase()).toBe(filename);
});

test('fs.realpath.native works correctly', async () => {
  const result = await new Promise((resolve, reject) => {
    fs.realpath.native(filename, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
  expect(result.toLowerCase()).toBe(filename);
});

//<#END_FILE: test-fs-realpath-native.js
