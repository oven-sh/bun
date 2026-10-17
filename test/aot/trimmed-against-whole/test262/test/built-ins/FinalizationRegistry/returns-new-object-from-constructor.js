// Copyright (C) 2019 Leo Balter. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-finalization-registry-target
description: >
  Returns a new ordinary object from the FinalizationRegistry constructor
info: |
  FinalizationRegistry ( cleanupCallback )

  ...
  3. Let finalizationRegistry be ? OrdinaryCreateFromConstructor(NewTarget,  "%FinalizationRegistryPrototype%", « [[Realm]], [[CleanupCallback]], [[Cells]], [[IsFinalizationRegistryCleanupJobActive]] »).
  ...
  9. Return finalizationRegistry.

  OrdinaryCreateFromConstructor ( constructor, intrinsicDefaultProto [ , internalSlotsList ] )

  ...
  2. Let proto be ? GetPrototypeFromConstructor(constructor, intrinsicDefaultProto).
  3. Return ObjectCreate(proto, internalSlotsList).
features: [FinalizationRegistry, for-of]
---*/

var cleanupCallback = function() {};
var finalizationRegistry = new FinalizationRegistry(cleanupCallback);

assert.sameValue(Object.getPrototypeOf(finalizationRegistry), FinalizationRegistry.prototype);
assert.notSameValue(finalizationRegistry, cleanupCallback, 'does not return the same function');
assert.sameValue(finalizationRegistry instanceof FinalizationRegistry, true, 'instanceof');

for (let key of Object.getOwnPropertyNames(finalizationRegistry)) {
  assert(false, `should not set any own named properties: ${key}`);
}

for (let key of Object.getOwnPropertySymbols(finalizationRegistry)) {
  assert(false, `should not set any own symbol properties: ${String(key)}`);
}

assert.sameValue(Object.getPrototypeOf(finalizationRegistry), FinalizationRegistry.prototype);
