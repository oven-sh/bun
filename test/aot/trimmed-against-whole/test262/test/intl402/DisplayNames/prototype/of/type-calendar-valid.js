// Copyright 2021 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-Intl.DisplayNames.prototype.of
description: Returns string value for valid `calendar` codes
features: [Intl.DisplayNames-v2]
---*/

var displayNames = new Intl.DisplayNames(undefined, {type: 'calendar'});

assert.sameValue(typeof displayNames.of('01234567'), 'string', '[0-7]');
assert.sameValue(typeof displayNames.of('899'), 'string', '[89]');

assert.sameValue(typeof displayNames.of('abcdefgh'), 'string', '[a-h]');
assert.sameValue(typeof displayNames.of('ijklmnop'), 'string', '[i-p]');
assert.sameValue(typeof displayNames.of('qrstuvwx'), 'string', '[q-x]');
assert.sameValue(typeof displayNames.of('yzz'), 'string', '[yz]');

assert.sameValue(typeof displayNames.of('ABCDEFGH'), 'string', '[A-H]');
assert.sameValue(typeof displayNames.of('IJKLMNOP'), 'string', '[I-P]');
assert.sameValue(typeof displayNames.of('QRSTUVWX'), 'string', '[Q-X]');
assert.sameValue(typeof displayNames.of('YZZ'), 'string', '[YZ]');

assert.sameValue(typeof displayNames.of('123-abc'), 'string', '2 segments, minimum length, dash');
assert.sameValue(typeof displayNames.of('12345678-abcdefgh'), 'string', '2 segments, maximum length, dash');
assert.sameValue(typeof displayNames.of('123-abc-ABC'), 'string', '3 segments, minimum length, dash');
assert.sameValue(typeof displayNames.of('12345678-abcdefgh-ABCDEFGH'), 'string', '3 segments, maximum length, dash');
