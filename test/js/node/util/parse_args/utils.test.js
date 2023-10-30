'use strict';

const tape = require('tape');

module.exports = {
  test: (description, body) => {
    tape(description, (t) => {
      t.deepStrictEqual = t.deepEqual;
      global.assert = t;
      body();
      t.end();
    });
  }
};
