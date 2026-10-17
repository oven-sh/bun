// Copyright (C) 2024 Kevin Gibbons. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-dataview.prototype.getfloat16
description: >
  Return value from Buffer using a clean ArrayBuffer
features: [Float16Array]
---*/

var buffer = new ArrayBuffer(8);
var sample = new DataView(buffer, 0);

assert.sameValue(sample.getFloat16(0, true), 0, "sample.getFloat16(0, true)");
assert.sameValue(sample.getFloat16(1, true), 0, "sample.getFloat16(1, true)");
assert.sameValue(sample.getFloat16(2, true), 0, "sample.getFloat16(2, true)");
assert.sameValue(sample.getFloat16(3, true), 0, "sample.getFloat16(3, true)");
assert.sameValue(sample.getFloat16(4, true), 0, "sample.getFloat16(4, true)");
assert.sameValue(sample.getFloat16(0, false), 0, "sample.getFloat16(0, false)");
assert.sameValue(sample.getFloat16(1, false), 0, "sample.getFloat16(1, false)");
assert.sameValue(sample.getFloat16(2, false), 0, "sample.getFloat16(2, false)");
assert.sameValue(sample.getFloat16(3, false), 0, "sample.getFloat16(3, false)");
assert.sameValue(sample.getFloat16(4, false), 0, "sample.getFloat16(4, false)");
