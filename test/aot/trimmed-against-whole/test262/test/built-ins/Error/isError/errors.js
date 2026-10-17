// Copyright (C) 2024 Jordan Harband.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-error.iserror
description: >
  Returns true on Error and Error subclass instances
features: [Error.isError]
---*/

assert.sameValue(Error.isError(new Error()), true);
assert.sameValue(Error.isError(new EvalError()), true);
assert.sameValue(Error.isError(new RangeError()), true);
assert.sameValue(Error.isError(new ReferenceError()), true);
assert.sameValue(Error.isError(new SyntaxError()), true);
assert.sameValue(Error.isError(new TypeError()), true);
assert.sameValue(Error.isError(new URIError()), true);

if (typeof AggregateError !== 'undefined') {
  assert.sameValue(Error.isError(new AggregateError([])), true);
}
if (typeof SuppressedError !== 'undefined') {
  assert.sameValue(Error.isError(new SuppressedError()), true);
}
