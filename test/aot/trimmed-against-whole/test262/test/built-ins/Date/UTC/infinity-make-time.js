// Copyright (C) 2016 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-date.utc
description: Infinite values specified to MakeTime produce NaN
info: |
  [...]
  9. Return TimeClip(MakeDate(MakeDay(yr, m, dt), MakeTime(h, min, s, milli))). 

  MakeTime (hour, min, sec, ms)

  1. If hour is not finite or min is not finite or sec is not finite or ms is
     not finite, return NaN.
---*/

assert.sameValue(Date.UTC(0, 0, 1, Infinity), NaN, 'hour: Infinity');
assert.sameValue(Date.UTC(0, 0, 1, -Infinity), NaN, 'hour: -Infinity');

assert.sameValue(Date.UTC(0, 0, 1, 0, Infinity), NaN, 'minute: Infinity');
assert.sameValue(Date.UTC(0, 0, 1, 0, -Infinity), NaN, 'minute: -Infinity');

assert.sameValue(Date.UTC(0, 0, 1, 0, 0, Infinity), NaN, 'second: Infinity');
assert.sameValue(Date.UTC(0, 0, 1, 0, 0, -Infinity), NaN, 'second: -Infinity');

assert.sameValue(Date.UTC(0, 0, 1, 0, 0, 0, Infinity), NaN, 'ms: Infinity');
assert.sameValue(Date.UTC(0, 0, 1, 0, 0, 0, -Infinity), NaN, 'ms: -Infinity');
