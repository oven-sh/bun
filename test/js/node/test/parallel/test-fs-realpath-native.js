'use strict';
const common = require('../common');
const assert = require('assert');
const fs = require('fs');

const filename = __filename.toLowerCase();

// Bun: fix current working directory
process.chdir(require('path').join(__dirname, '..', '..')); 

assert.strictEqual(
  fs.realpathSync.native('./test/parallel/test-fs-realpath-native.js')
    .toLowerCase(),
  filename);

fs.realpath.native(
  './test/parallel/test-fs-realpath-native.js',
  common.mustSucceed(function(res) {
    assert.strictEqual(res.toLowerCase(), filename);
    assert.strictEqual(this, undefined);
  }));
