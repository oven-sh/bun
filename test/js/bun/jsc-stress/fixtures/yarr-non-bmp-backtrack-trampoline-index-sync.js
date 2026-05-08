// @bun
// Regression test for the Yarr JIT non-BMP first-character optimization.
//
// The BodyAlternativeEnd backtrack trampoline, when looping from a last
// alternative whose minimumSize is greater than the first's, advanced
// matchStart by firstCharacterAdditionalReadSize but left m_regs.index
// unchanged. A zero-width first alternative (e.g. \B) could then succeed
// with output[0] > output[1], and the computed match length underflowed to
// 4294967295.
//
// The optimization is enabled when ENABLE(YARR_JIT_UNICODE_CAN_INCREMENT_INDEX_FOR_NON_BMP),
// which today is ARM64-only. On other architectures this test exercises the
// non-optimized path and should also pass.

function check(re, input, label) {
  var m = re.exec(input);
  if (m === null) return;
  if (typeof m[0] !== "string")
    throw new Error(label + ": match[0] is not a string");
  // The whole-match slice must never have end < start. When it does,
  // jsSubstringOfResolved wraps and .length becomes (unsigned)-1.
  if (m[0].length > input.length)
    throw new Error(label + ": match[0].length=" + m[0].length + " exceeds input.length=" + input.length);
  if (m.index + m[0].length > input.length)
    throw new Error(label + ": match extends past end (index=" + m.index + " len=" + m[0].length + ")");
}

var inputs = [
  "a\u{10ffff}b",
  "a\u{10ffff}",
  "\u{10ffff}b",
  "\u{10ffff}",
  "a\u{10ffff}\u{10ffff}b",
  "aa\u{10ffff}bb",
];

for (var i = 0; i < testLoopCount; ++i) {
  for (var j = 0; j < inputs.length; ++j) {
    var s = inputs[j];
    // delta == 1 (last alt minSize 1, first alt minSize 0)
    check(/\B|x{1,2}?/u, s, "\\B|x{1,2}? on " + JSON.stringify(s));
    // delta == 2 (last alt minSize 2, first alt minSize 0)
    check(/\B|xy{1,2}?/u, s, "\\B|xy{1,2}? on " + JSON.stringify(s));
    // Second alternative that matches past the pair.
    check(/\B|b{1,2}?/u, s, "\\B|b{1,2}? on " + JSON.stringify(s));
    // /m disables the optimization; must behave identically to the interpreter.
    check(/\B|x{1,2}?/mu, s, "\\B|x{1,2}?/mu on " + JSON.stringify(s));
  }

  // Direct assertion for the originally-reported case.
  var m = /\B|x{1,2}?/u.exec("a\u{10ffff}b");
  if (m !== null && m[0].length !== 0)
    throw new Error("expected empty match, got length " + m[0].length);
}
