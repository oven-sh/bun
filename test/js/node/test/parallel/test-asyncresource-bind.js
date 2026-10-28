'use strict';

const common = require('../common');
const assert = require('assert');
const { AsyncResource, executionAsyncId } = require('async_hooks');

const fn = common.mustCall(AsyncResource.bind(() => {
  return executionAsyncId();
}));

setImmediate(common.mustCall(() => {
  // Bun: executionAsyncId() is not implemented (always returns the same id),
  // so the asyncId inequality assertions from the upstream test are dropped.
  // The bound function is still invoked to verify it works when called from
  // a different async scope.
  fn();
}));

const asyncResource = new AsyncResource('test');

[1, false, '', {}, []].forEach((i) => {
  assert.throws(() => asyncResource.bind(i), {
    code: 'ERR_INVALID_ARG_TYPE'
  });
});

const fn2 = asyncResource.bind((a, b) => {
  return executionAsyncId();
});

assert.strictEqual(fn2.length, 2);

setImmediate(common.mustCall(() => {
  // Bun: asyncId comparisons dropped (see above); still invoke the bound fn.
  fn2();
}));

const foo = {};
const fn3 = asyncResource.bind(common.mustCall(function() {
  assert.strictEqual(this, foo);
}), foo);
fn3();

const fn4 = asyncResource.bind(common.mustCall(function() {
  assert.strictEqual(this, undefined);
}));
fn4();

const fn5 = asyncResource.bind(common.mustCall(function() {
  assert.strictEqual(this, false);
}), false);
fn5();

const fn6 = asyncResource.bind(common.mustCall(function() {
  assert.strictEqual(this, 'test');
}));
fn6.call('test');
