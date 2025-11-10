'use strict';
require('../common');

// Return type of shorthands should be consistent
// with the return type of test

const assert = require('assert');
const { test, describe, it } = require('node:test');

const testOnly = typeof Bun === 'undefined' ? test('only test', { only: true }) : undefined; // disabled in bun because test.only is disabled in CI environments and it will skip the describe/it
const testTodo = test('todo test', { todo: true });
const testSkip = test('skip test', { skip: true });
const testOnlyShorthand = typeof Bun === 'undefined' ? test.only('only test shorthand') : undefined; // disabled in bun because test.only is disabled in CI environments and it will skip the describe/it
const testTodoShorthand = test.todo('todo test shorthand');
const testSkipShorthand = test.skip('skip test shorthand');

describe('\'node:test\' and its shorthands should return the same', () => {
  it('should return undefined', () => {
    assert.strictEqual(testOnly, undefined);
    assert.strictEqual(testTodo, undefined);
    assert.strictEqual(testSkip, undefined);
    assert.strictEqual(testOnlyShorthand, undefined);
    assert.strictEqual(testTodoShorthand, undefined);
    assert.strictEqual(testSkipShorthand, undefined);
  });
});
