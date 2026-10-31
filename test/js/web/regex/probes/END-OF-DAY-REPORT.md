# Yarr lookbehind JIT — end-of-day report (2026-07-16)

## What shipped in the final diff (7 files, ~2058 lines)
Unicode lookbehinds are JIT-compiled through the mirrored-body machinery (no
interpreter fallback). isbot benchmark ~120 ms (stock ~32,000 ms); the /iu, /iv
lookbehind performance cliff is closed.

## Bugs fixed today (all with regression pins in the test repo)
Introduced-and-fixed within the project (found by soaks / review):
- lazy quantified group in a lookbehind stopped re-entering (progress guard direction-aware)
- ^ and \b at a nonzero body origin (nested assertion in lookbehind): general position test
- ^ inside a lookbehind wrongly marked startsWithBOL; {0}-quantified BOL group over-anchored
- shared nested-forward-assertion body mutated (broke the interpreter fallback): deep copy
- dotAll any-character class matched a dangling surrogate under /u,/v
- SIGBUS: leftward pair-lead borrow left a negative frontier live (claimBackwardPairLead)
- firstCharacterAdditionalReadSize register discipline (ambient-off; start-read only);
  isLiteral hedge removed after A/B proof
- astral-start skip disabled for zero-width-capable patterns (mid-pair matches were dropped)
- QUANTIFIED-SPLIT CAPTURE OWNERSHIP (the day's main hunt): root cause = the paren-Begin
  backtrack zero-iteration clears erasing captures an isCopy piece never owned, AFTER
  restoreParenContext restored them; fixed by a two-line !isCopy gate; the End-side
  mitigation stack built along the way was proven dead and DELETED
- CRASH: an intermediate all-split routing made nested min>0 groups exponential
  (106-char pattern killed jsc); forward parens restored to stock's native routing

## Upstream (pre-existing WebKit) bugs — see UPSTREAM-BUGS.md for the full catalogue
Fixed here because they were in the way (5): register discipline; dotAll dangling
surrogate; anchor real-position; NonGreedy progress guard; astral-skip premise.
Catalogued, not fixed (interpreter and shared-layer, incl. two found tonight):
- bytecode-interpreter alternation-order bug (^ as non-first alt + trailing lazy class)
- bytecode-interpreter lone-surrogate quantified backref over-consumes (/(.)\1?/u)
- interpreter astral-in-lookbehind class bugs the new JIT does not share
- capture not cleared after failed assertion attempt (all JSC engines vs V8)
- /v mid-pair empty-match iteration policy; class-first equal-min residue (JIT)
- V8 sticky snap-back (V8 policy, not a JSC bug)
Plus one METHODOLOGY hazard: a runtime JIT punt is sticky per RegExp AND per
RegExpCache entry -> differential testing must run one case per fresh process.

## Verification record (final build)
- test262 built-ins/RegExp: 3754/3754 on BOTH tiers (fresh process per test);
  String regex methods 676/676; JSTests regex stress 234 files x 2 tiers clean;
  LayoutTests js/regexp + fast/regex 51 x 2 clean
- three ~6MB differential corpora byte-identical across tiers; 108-case corpus and
  7020-case matrix agree with node (pinned family only)
- punt-immune sweeps (one case per fresh process): 3140-case split space, 500-case
  randomized nesting (0 divergence, 0 crashes), review agents' ~24,300 + ~29,000 cases
- closing soaks: every divergent seed classified fixed or pre-existing; zero introduced
- perf: isbot 120 ms; nesting depth 21/30/50 forward and depth 10 backward all instant

## Consciously deferred refactors (behavior-neutral; not applied at session end)
- duplicated backward-unicode "take" stanzas across the greedy/non-greedy emitters
- mirrorDisjunctionForLookbehind vs copyForwardDisjunctionForMirror wrapper duplication
