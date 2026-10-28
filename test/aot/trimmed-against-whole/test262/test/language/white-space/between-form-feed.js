// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: FORM FEED (U+000C) between any two tokens is allowed
es5id: 7.2_A1.3_T2
description: Insert real FORM FEED between tokens of var x=1
---*/

varx=1;

assert.sameValue(x, 1);
