// Copyright 2014 Cubane Canada, Inc.  All rights reserved.
// See LICENSE for details.

/*---
info: |
    Promise.all with 1-element array
    should accept an array with settled promise
es6id: S25.4.4.1_A6.1_T2
author: Sam Mikes
description: Promise.all([p1]) is resolved with a promise for a one-element array
flags: [async]
---*/

var p1 = Promise.resolve(3);

var pAll = Promise.all([p1]);

pAll.then(function(result) {
  assert(!!(pAll instanceof Promise), 'The value of !!(pAll instanceof Promise) is expected to be true');
  assert(!!(result instanceof Array), 'The value of !!(result instanceof Array) is expected to be true');
  assert.sameValue(result.length, 1, 'The value of result.length is expected to be 1');
  assert.sameValue(result[0], 3, 'The value of result[0] is expected to be 3');
}).then($DONE, $DONE);
