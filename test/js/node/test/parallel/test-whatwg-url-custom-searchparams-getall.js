'use strict';

// Tests below are not from WPT.

require('../common');
const assert = require('assert');

{
  const params = new URLSearchParams();
  assert.throws(() => {
    params.getAll.call(undefined);
  }, {
    code: 'ERR_INVALID_THIS',
    name: 'TypeError',
    message: 'Can only call URLSearchParams.getAll on instances of URLSearchParams',
  });
  assert.throws(() => {
    params.getAll();
  }, {
    code: 'ERR_MISSING_ARGS',
    name: 'TypeError',
    message: 'Not enough arguments'
  });

  const obj = {
    toString() { throw new Error('toString'); },
    valueOf() { throw new Error('valueOf'); }
  };
  const sym = Symbol();
  assert.throws(() => params.getAll(obj), /^Error: toString$/);
  assert.throws(() => params.getAll(sym),
                /^TypeError: Cannot convert a symbol to a string$/);
}
