'use strict';

const common = require('../common');
const { EventEmitterAsyncResource } = require('events');

const assert = require('assert');

// Bun: the upstream test verifies init/before/after/destroy async_hooks events
// fired by EventEmitterAsyncResource. Bun does not implement createHook event
// tracking, so those tracer assertions are dropped; this adaptation keeps the
// public API surface assertions.

// Tracks emit() calls correctly
(async () => {
  class Foo extends EventEmitterAsyncResource {}

  const foo = new Foo();

  foo.on('someEvent', common.mustCall());
  foo.emit('someEvent');

  assert.strictEqual(typeof foo.asyncId, 'number');
  assert.strictEqual(typeof foo.triggerAsyncId, 'number');
  assert.strictEqual(foo.asyncResource.eventEmitter, foo);

  foo.emitDestroy();
})().then(common.mustCall());

// Can explicitly specify name as positional arg
(async () => {
  class Foo extends EventEmitterAsyncResource {}

  const foo = new Foo('ResourceName');
  assert.strictEqual(foo.asyncResource.eventEmitter, foo);
})().then(common.mustCall());

// Can explicitly specify name as option
(async () => {
  class Foo extends EventEmitterAsyncResource {}

  const foo = new Foo({ name: 'ResourceName' });
  assert.strictEqual(foo.asyncResource.eventEmitter, foo);
})().then(common.mustCall());

assert.throws(
  () => EventEmitterAsyncResource.prototype.emit(),
  { name: 'TypeError' }
);

assert.throws(
  () => EventEmitterAsyncResource.prototype.emitDestroy(),
  { name: 'TypeError' }
);
