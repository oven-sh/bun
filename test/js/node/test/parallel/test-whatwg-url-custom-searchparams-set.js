'use strict';

// Tests below are not from WPT.

require('../common');
const assert = require('assert');

{
  const params = new URLSearchParams();
  assert.throws(() => {
    params.set.call(undefined);
  }, {
    code: 'ERR_INVALID_THIS',
    name: 'TypeError',
    message: 'Can only call URLSearchParams.set on instances of URLSearchParams',
  });
  assert.throws(() => {
    params.set('a');
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
  assert.throws(() => params.append(obj, 'b'), /^Error: toString$/);
  assert.throws(() => params.append('a', obj), /^Error: toString$/);
  assert.throws(() => params.append(sym, 'b'),
                /^TypeError: Cannot convert a symbol to a string$/);
  assert.throws(() => params.append('a', sym),
                /^TypeError: Cannot convert a symbol to a string$/);
}
