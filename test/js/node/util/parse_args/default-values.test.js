/* global assert */
/* eslint max-len: 0 */
'use strict';

const { test } = require('./utils');
const { parseArgs } = require('../index.js');

test('default must be a boolean when option type is boolean', () => {
  const args = [];
  const options = { alpha: { type: 'boolean', default: 'not a boolean' } };
  assert.throws(() => {
    parseArgs({ args, options });
  }, /options\.alpha\.default must be Boolean/
  );
});

test('default must accept undefined value', () => {
  const args = [];
  const options = { alpha: { type: 'boolean', default: undefined } };
  const result = parseArgs({ args, options });
  const expected = {
    values: {
      __proto__: null,
    },
    positionals: []
  };
  assert.deepStrictEqual(result, expected);
});

test('default must be a boolean array when option type is boolean and multiple', () => {
  const args = [];
  const options = { alpha: { type: 'boolean', multiple: true, default: 'not an array' } };
  assert.throws(() => {
    parseArgs({ args, options });
  }, /options\.alpha\.default must be Array/
  );
});

test('default must be a boolean array when option type is string and multiple is true', () => {
  const args = [];
  const options = { alpha: { type: 'boolean', multiple: true, default: [true, true, 42] } };
  assert.throws(() => {
    parseArgs({ args, options });
  }, /options\.alpha\.default\[2\] must be Boolean/
  );
});

test('default must be a string when option type is string', () => {
  const args = [];
  const options = { alpha: { type: 'string', default: true } };
  assert.throws(() => {
    parseArgs({ args, options });
  }, /options\.alpha\.default must be String/
  );
});

test('default must be an array when option type is string and multiple is true', () => {
  const args = [];
  const options = { alpha: { type: 'string', multiple: true, default: 'not an array' } };
  assert.throws(() => {
    parseArgs({ args, options });
  }, /options\.alpha\.default must be Array/
  );
});

test('default must be a string array when option type is string and multiple is true', () => {
  const args = [];
  const options = { alpha: { type: 'string', multiple: true, default: ['str', 42] } };
  assert.throws(() => {
    parseArgs({ args, options });
  }, /options\.alpha\.default\[1\] must be String/
  );
});

test('default accepted input when multiple is true', () => {
  const args = ['--inputStringArr', 'c', '--inputStringArr', 'd', '--inputBoolArr', '--inputBoolArr'];
  const options = {
    inputStringArr: { type: 'string', multiple: true, default: ['a', 'b'] },
    emptyStringArr: { type: 'string', multiple: true, default: [] },
    fullStringArr: { type: 'string', multiple: true, default: ['a', 'b'] },
    inputBoolArr: { type: 'boolean', multiple: true, default: [false, true, false] },
    emptyBoolArr: { type: 'boolean', multiple: true, default: [] },
    fullBoolArr: { type: 'boolean', multiple: true, default: [false, true, false] },
  };
  const expected = { values: { __proto__: null,
                               inputStringArr: ['c', 'd'],
                               inputBoolArr: [true, true],
                               emptyStringArr: [],
                               fullStringArr: ['a', 'b'],
                               emptyBoolArr: [],
                               fullBoolArr: [false, true, false] },
                     positionals: [] };
  const result = parseArgs({ args, options });
  assert.deepStrictEqual(result, expected);
});

test('when default is set, the option must be added as result', () => {
  const args = [];
  const options = {
    a: { type: 'string', default: 'HELLO' },
    b: { type: 'boolean', default: false },
    c: { type: 'boolean', default: true }
  };
  const expected = { values: { __proto__: null, a: 'HELLO', b: false, c: true }, positionals: [] };

  const result = parseArgs({ args, options });
  assert.deepStrictEqual(result, expected);
});

test('when default is set, the args value takes precedence', () => {
  const args = ['--a', 'WORLD', '--b', '-c'];
  const options = {
    a: { type: 'string', default: 'HELLO' },
    b: { type: 'boolean', default: false },
    c: { type: 'boolean', default: true }
  };
  const expected = { values: { __proto__: null, a: 'WORLD', b: true, c: true }, positionals: [] };

  const result = parseArgs({ args, options });
  assert.deepStrictEqual(result, expected);
});

test('tokens should not include the default options', () => {
  const args = [];
  const options = {
    a: { type: 'string', default: 'HELLO' },
    b: { type: 'boolean', default: false },
    c: { type: 'boolean', default: true }
  };

  const expectedTokens = [];

  const { tokens } = parseArgs({ args, options, tokens: true });
  assert.deepStrictEqual(tokens, expectedTokens);
});

test('tokens:true should not include the default options after the args input', () => {
  const args = ['--z', 'zero', 'positional-item'];
  const options = {
    z: { type: 'string' },
    a: { type: 'string', default: 'HELLO' },
    b: { type: 'boolean', default: false },
    c: { type: 'boolean', default: true }
  };

  const expectedTokens = [
    { kind: 'option', name: 'z', rawName: '--z', index: 0, value: 'zero', inlineValue: false },
    { kind: 'positional', index: 2, value: 'positional-item' },
  ];

  const { tokens } = parseArgs({ args, options, tokens: true, allowPositionals: true });
  assert.deepStrictEqual(tokens, expectedTokens);
});

test('proto as default value must be ignored', () => {
  const args = [];
  const options = Object.create(null);

  // eslint-disable-next-line no-proto
  options.__proto__ = { type: 'string', default: 'HELLO' };

  const result = parseArgs({ args, options, allowPositionals: true });
  const expected = { values: { __proto__: null }, positionals: [] };
  assert.deepStrictEqual(result, expected);
});


test('multiple as false should expect a String', () => {
  const args = [];
  const options = { alpha: { type: 'string', multiple: false, default: ['array'] } };
  assert.throws(() => {
    parseArgs({ args, options });
  }, / must be String got array/);
});
