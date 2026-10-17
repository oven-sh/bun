// Copyright (C) 2017 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-assertion
description: Nested lookaround
info: |
  The production Assertion :: (?<=Disjunction) evaluates as follows:
    1. Evaluate Disjunction with -1 as its direction argument to obtain a Matcher m.
    2. Return an internal Matcher closure that takes two arguments, a State x and a Continuation
        c, and performs the following steps:
      a. Let d be a Continuation that always returns its State argument as a successful MatchResult.
      b. Call m(x, d) and let r be its result.
      c. If r is failure, return failure.
      d. Let y be r's State.
      e. Let cap be y's captures List.
      f. Let xe be x's endIndex.
      g. Let z be the State (xe, cap).
      h. Call c(z) and return its result.
features: [regexp-lookbehind]
includes: [compareArray.js]
---*/

assert.compareArray("abcdef".match(/(?<=ab(?=c)\wd)\w\w/), ["ef"], "#1");
assert.compareArray("abcdef".match(/(?<=a(?=([^a]{2})d)\w{3})\w\w/), ["ef", "bc"], "#2");
assert.compareArray("abcdef".match(/(?<=a(?=([bc]{2}(?<!a{2}))d)\w{3})\w\w/), ["ef", "bc"], "#3");
assert.compareArray("faaao".match(/^faaao?(?<=^f[oa]+(?=o))/), ["faaa"], "#4");

assert.sameValue("abcdef".match(/(?<=a(?=([bc]{2}(?<!a*))d)\w{3})\w\w/), null, "#5");
