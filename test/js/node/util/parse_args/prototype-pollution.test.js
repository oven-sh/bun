'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { parseArgs } = require('../index.js');

// These tests are not synced upstream with node, in case of possible side-effects.
// See index.js for tests shared with upstream.

function setObjectPrototype(prop, value) {
  const oldDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, prop);
  Object.prototype[prop] = value;
  return oldDescriptor;
}

function restoreObjectPrototype(prop, oldDescriptor) {
  if (oldDescriptor == null) {
    delete Object.prototype[prop];
  } else {
    Object.defineProperty(Object.prototype, prop, oldDescriptor);
  }
}

test('should not allow __proto__ key to be set on object', (t) => {
  const args = ['--__proto__=hello'];
  const expected = { values: { __proto__: null }, positionals: [] };

  const result = parseArgs({ strict: false, args });

  t.deepEqual(result, expected);
  t.end();
});

test('when prototype has multiple then ignored', (t) => {
  const args = ['--foo', '1', '--foo', '2'];
  const options = { foo: { type: 'string' } };
  const expectedResult = { values: { __proto__: null, foo: '2' }, positionals: [] };

  const holdDescriptor = setObjectPrototype('multiple', true);
  const result = parseArgs({ args, options });
  restoreObjectPrototype('multiple', holdDescriptor);
  t.deepEqual(result, expectedResult);
  t.end();
});

test('when prototype has type then ignored', (t) => {
  const args = ['--foo', '1'];
  const options = { foo: { } };

  const holdDescriptor = setObjectPrototype('type', 'string');
  t.throws(() => {
    parseArgs({ args, options });
  });
  restoreObjectPrototype('type', holdDescriptor);
  t.end();
});

test('when prototype has short then ignored', (t) => {
  const args = ['-f', '1'];
  const options = { foo: { type: 'string' } };

  const holdDescriptor = setObjectPrototype('short', 'f');
  t.throws(() => {
    parseArgs({ args, options });
  });
  restoreObjectPrototype('short', holdDescriptor);
  t.end();
});

test('when prototype has strict then ignored', (t) => {
  const args = ['-f'];

  const holdDescriptor = setObjectPrototype('strict', false);
  t.throws(() => {
    parseArgs({ args });
  });
  restoreObjectPrototype('strict', holdDescriptor);
  t.end();
});

test('when prototype has args then ignored', (t) => {
  const holdDescriptor = setObjectPrototype('args', ['--foo']);
  const result = parseArgs({ strict: false });
  restoreObjectPrototype('args', holdDescriptor);
  t.false(result.values.foo);
  t.end();
});
