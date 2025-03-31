'use strict';

// Tests below are not from WPT.

require('../common');
const assert = require('assert');

{
  const params = new URLSearchParams();
  assert.throws(() => {
    params.append.call(undefined);
  }, {
    code: 'ERR_INVALID_THIS',
    name: 'TypeError',
    message: 'Can only call URLSearchParams.append on instances of URLSearchParams',
  });
  assert.throws(() => {
    params.append('a');
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
  assert.throws(() => params.set(obj, 'b'), /^Error: toString$/);
  assert.throws(() => params.set('a', obj), /^Error: toString$/);
  assert.throws(() => params.set(sym, 'b'),
                /^TypeError: Cannot convert a symbol to a string$/);
  assert.throws(() => params.set('a', sym),
                /^TypeError: Cannot convert a symbol to a string$/);
}
