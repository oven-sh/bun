// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: "IdentifierStart :: $"
es5id: 7.6_A1.2_T1
description: Create variable $
---*/

//CHECK#1
var $ = 1;

assert.sameValue($, 1);
