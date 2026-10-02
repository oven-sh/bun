# Pre-existing (upstream WebKit) regex bugs identified during the Yarr lookbehind-JIT work

Classification key. Every divergence found by the differential harness was arbitrated
against three oracles: the other JSC tier (JIT vs bytecode interpreter), stock bun 1.3.14
(unmodified WebKit), and node (V8). A bug is UPSTREAM when unmodified WebKit reproduces it.

## A. Upstream JSC bugs FIXED as part of this project (they were in the way)

1. firstCharacterAdditionalReadSize register discipline (JIT). A non-BMP read that is not
   the match start could set the "start char is astral" register, so the next start
   position advanced by an extra unit and skipped a real match. Reproduces on stock:
   /😀|-?a/u.exec("-😀") -> null (correct [1,"😀"]). Fixed by redesigning the register's
   scope: ambient-off, enabled only while emitting the start-read term.
2. dotAll any-character class matched a dangling surrogate under /u,/v (JIT). The
   m_anyCharacter fast path skipped the errorCodePoint rejection every other class path
   applies, so /(?!.)/gvs skipped mid-surrogate-pair empty matches:
   [..."😀😀".matchAll(/(?!.)/gvs)] gave 1 match on stock JIT vs 3 in the interpreter.
   Fixed: the any-char class rejects errorCodePoint in unicode compiles.
3. Non-multiline ^ / \b at a nonzero body origin (JIT). generateAssertionBOL treated any
   ^ with inputPosition != 0 as unsatisfiable ("Erk, poison"), and \b keyed its
   start-of-input edge on !inputPosition; both are wrong for an anchor whose alternative
   is numbered from a nonzero origin (previously unreachable; reachable once assertion
   bodies compile nested). Fixed with the general real-position test
   index == checkedOffset - inputPosition.
4. NonGreedy paren "try one more iteration" progress guard assumed forward progress
   (index > beginIndex), so a leftward-consuming lazy group never re-entered. Latent
   upstream (backward parens never JIT-compiled before); fixed direction-aware.

4b. First-non-BMP-character skip premise (JIT, upstream design flaw). The optimization
    advances the next match start past the trailing surrogate of an astral start
    character, assuming no match can begin mid-pair. That is false whenever the pattern
    can match zero-width (a negative lookahead over ., an assertion, an empty
    alternative): such an alternative legitimately succeeds at a dangling-trail
    position, and the skip drops it. Upstream never noticed because its ambient
    register was routinely clobbered to 0 by unrelated reads before the advance -- the
    skip almost never actually took effect. Making the register faithful (item 1) exposed
    the premise: (?![\w9A-Z]+|.[0xb]?)|c[[9]&&[\d]] /gv on "😀😀" -> [4] instead of
    [1,3,4]. Fixed by keying the whole optimization on the pattern being unable to match
    zero-width (m_body->m_minimumSize != 0); every pattern where the premise holds --
    including all the perf-relevant astral scans -- keeps the skip.

## B. Upstream JSC bugs NOT fixed (catalogued; JSC tiers agree, differ from V8)

5. /v-mode mid-surrogate-pair empty-match iteration. JSC (both tiers, stock too) attempts
   match starts at indices inside a surrogate pair and reports empty matches there; V8
   snaps to pair boundaries. E.g. /(?<=.)/gu on "😀c" starts at 1 (V8: 2); the
   "😀😀".match(/(?<!.)/givms) family (JSC 3 matches / V8 2 / ours-JIT-after-fix 1 --
   three engines, three answers; no two policies agree). Shared-layer semantics.
6. Capture NOT cleared after a failed assertion attempt: ALL JSC engines (JIT,
   interpreter, stock) keep a group value that V8 reports as undefined for a group whose
   alternative did not participate. E.g. /\t|(?=^|Ω|\t[\s\w])((?:\1){2,}?.{2}\W{0,2}|.(?!d{2,}?)|\t+(?:\1)??)/v
   on "\n\t\n" -> ["\t","\t"] (V8 ["\t",null]). Pinned:
   capture-not-cleared-lookahead-forward-ref.
7. Class-first equal-minimum astral alternative over-advance (JIT-only; interpreter and
   V8 correct): /😀|[qz]a/u.exec("-😀") -> JIT null, correct [1,"😀"]. Requires an
   astral first alternative + a following alternative of EQUAL minimum size led by a
   non-inverted BMP class. Pinned: jit-astral-eqmin-classfirst-* (4 variants).
8. Bytecode-INTERPRETER bug: a bare ^ as a non-first alternative combined with a trailing
   lazy counted class of the same class scans wrong. /\d{1,3}?b|^|\d4?/g on
   "prefix 11b suffix" -> interpreter [[0,""],[7,"1"],[8,"1b"]] (correct
   [[0,""],[7,"11b"]]); the interpreter prefers the later \d4? alternative over the earlier
   \d{1,3}?b at position 7 (an alternation-order violation). Reproduces with the stock
   interpreter (BUN_JSC_useRegExpJIT=0). The JIT is correct. Any pattern shape that punts
   from the JIT to the interpreter (bug 200786 empty-iteration abort) can land on it; this
   project's paren routing keeps min-0-body quantified groups on the split path
   specifically so no additional shapes reach this interpreter bug via the punt.
9. Bytecode-INTERPRETER astral-in-lookbehind bugs the new JIT does not share (JIT == V8):
   /(?<=[\u{1F600}-\u{1F64F}a])x/u.exec("😀x") -> interpreter null (correct ["x"]); same
   for /(?<=x\u{1F400}{2})$/u, [\q{🐀|q}]{2}, \p{Emoji_Presentation} lookbehinds; and a
   stock-interpreter self-inconsistency /(?<=[^a]\B[^a]*)/u failing where /(?<=[^a]\B)/u
   succeeds at a mid-pair start. These affect useRegExpJIT=false platforms and any
   JIT-bailing pattern; found by the differential (Angle A / BC review agents), not
   caused by this change.
9b. Bytecode-INTERPRETER backreference matches a DIFFERENT lone surrogate. With /u,
    when a group captures a lone TRAIL surrogate and a quantified backreference then
    faces a lone LEAD surrogate, the interpreter lets the backreference consume it as
    if the two lone surrogates were the same character: /q(.)\1?/u on
    "q\ude00\ud83db" -> interpreter ["q\ude00\ud83d","\ude00"] (correct
    ["q\ude00","\ude00"] -- \1? must match empty). Reproduces on the stock
    interpreter (BUN_JSC_useRegExpJIT=0); the JIT (ours and stock) and V8 are correct.
    Independent of any class-head; found by the broad randomized final-review sweep.
9c. Bytecode-INTERPRETER backward dotAll-astral: /(?<=a.{3})bcx/su on
    "yzbab\U0001F600bbcx" -> interpreter null (correct ["bcx",8], which V8 and this
    project's JIT give). Reproduces with a pure FixedCount .{3} (no split, no group), so
    it is the untouched interpreter's astral backward `.` under dotAll; stock JSC gives
    null on BOTH tiers, i.e. stock is entirely wrong here and the new JIT is an
    improvement over stock. Found by the final guard review's /su fuzzing.
9d. Split-vs-native order-dependence with a FORWARD REFERENCE in a backward group
    (\2 appearing before group 2): /(?<=z(\2|b){2,3}(c))x/ (the group splits, since it
    is the first quantification) -> null on both JSC tiers and on stock, versus the
    equivalent /(?<=(?:z){1,2}(\2|b){2,3}(c))x/ (the group goes native because an earlier
    quantification already split) -> ["x","b","c"], matching V8. The routing condition and
    interpreter are stock's, so this is pre-existing shared-layer behaviour surfaced by the
    pattern-wide m_hasCopiedParenSubexpressions flag, not introduced here.
10. Forward surrogate-mask typo (relayed by a reviewer, pre-existing): a surrogateTagMask
    of 0xdc00dc00 that should be 0xfc00fc00 makes /\u{10402}/u.test("ﰂ") ->
    true. Not yet acted on.
11. Documented JIT limitation, bug 200786 (upstream FIXME at four sites): quantified
    groups whose body can match empty punt to the interpreter (m_abortExecution) on an
    empty iteration. Not a wrong-answer bug by itself (the fallback is designed to be
    correct) but it is the mechanism by which interpreter bug #8 becomes user-visible.

## C. V8-vs-JSC differences that are V8's policy, not JSC bugs

12. V8 sticky-mode (y) snap-back: with a mid-pair lastIndex, V8 re-anchors the match to
    the pair boundary; JSC starts at lastIndex. Distinct semantic choice.

## D. Differential-testing hazard (methodology, not an engine bug)

13. Runtime JIT punt is sticky per RegExp AND per RegExpCache entry (upstream design). A
    pattern that punts to the interpreter once (bug 200786 empty iteration, code size,
    etc.) interprets for the rest of the process; a fresh `new RegExp(src)` of the same
    source hits the cache and inherits it, and fullGC() does not clear it. Any harness
    that reuses a pattern across many inputs in one process silently compares
    interpreter-vs-interpreter after the first punting input, masking JIT bugs. Reliable
    JIT-vs-interpreter differential testing needs one (pattern, input) case per fresh
    process. This project's soak driver and one-case.mjs are fresh-process per case;
    the multi-input probe tables are only trustworthy per pattern up to its first punt.
