// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: Operator use ToString
esid: sec-parseint-string-radix
description: Checking for String object
---*/

assert.sameValue(parseInt(new String("-1")), parseInt("-1"), 'parseInt(new String("-1")) must return the same value returned by parseInt("-1")');

assert.sameValue(
  String(parseInt(new String("Infinity"))),
  "NaN",
  'String(parseInt(new String("Infinity"))) must return "NaN"'
);

assert.sameValue(String(parseInt(new String("NaN"))), "NaN", 'String(parseInt(new String("NaN"))) must return "NaN"');
assert.sameValue(String(parseInt(new String("false"))), "NaN", 'String(parseInt(new String("false"))) must return "NaN"');
