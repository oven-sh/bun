// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: Boolean() returns false
esid: sec-terms-and-definitions-boolean-value
description: Call Boolean() and check result
---*/
assert.sameValue(typeof Boolean(), "boolean", 'The value of `typeof Boolean()` is expected to be "boolean"');
assert.sameValue(Boolean(), false, 'Boolean() must return false');
