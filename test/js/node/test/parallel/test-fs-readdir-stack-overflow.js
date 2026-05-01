'use strict';

require('../common');

const assert = require('assert');
const fs = require('fs');

// Bun:  ~31,994
// Node: ~7,879
// Avoid the test timing out due to calling readdirSync ~30,000 times by using a smaller directory.
const path = require("path");
const dir = path.join(__dirname, '..');

function recurse() {
  fs.readdirSync(dir);
  recurse();
}

assert.throws(
  () => recurse(),
  {
    name: 'RangeError',
    message: 'Maximum call stack size exceeded.'
  }
);
