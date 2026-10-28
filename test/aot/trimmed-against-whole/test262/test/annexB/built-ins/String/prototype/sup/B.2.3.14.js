// Copyright (C) 2014 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

// Tests taken from:
// http://mathias.html5.org/tests/javascript/string/

/*---
description: >
    String.prototype.sup returns a string of HTML describing a single HTML
    superscript element. The element's content is the `this` value of the
    function invocation, coerced to a string.
es6id: B.2.3.14
---*/

assert.sameValue('_'.sup(), '<sup>_</sup>');
assert.sameValue('<'.sup(), '<sup><</sup>');
assert.sameValue(String.prototype.sup.call(0x2A), '<sup>42</sup>');
assert.throws(TypeError, function() {
  String.prototype.sup.call(undefined);
});
assert.throws(TypeError, function() {
  String.prototype.sup.call(null);
});
