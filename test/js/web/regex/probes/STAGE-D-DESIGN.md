# Stage D: unicode lookbehind in the JIT (full, no fallback)

## Grounding facts (verified in source)
- Claim/offset bookkeeping is in CODE UNITS everywhere. A fixed-count literal
  in a unicode pattern contributes U16_LENGTH(ch) * count units to
  currentInputPosition (setupAlternativeOffsets). A non-BMP literal is 2.
- A class term with variable width (BMP+non-BMP members, or `.`/negated in
  /u) sets alternative->m_hasFixedSize = false and gets a frame slot; it is
  matched by the counted/greedy loop paths that adjust index per read.
- The interpreter's backward reader (tryReadBackward): read input[p]; if it
  is a TRAIL surrogate and input[p-1] is a LEAD, rewind one extra unit and
  return the decoded pair. A lone lead or lone trail is returned as itself
  (NO error) -- unlike the forward reader, which can yield errorCodePoint.
  This asymmetry must be preserved exactly.
- Backward alternatives claim m_minimumSize units up front (existing
  Backward machinery); variable extra is consumed by decrementing index
  further as terms match wider characters.

## Term contract in Backward + decodeSurrogatePairs
Reading "the character ending at unit position q" = decode backward at q.

1. Backward unicode reader (new): given the address of unit q-1
   (the last unit of the char), load it; if TRAIL and unit q-2 is LEAD and
   in bounds, produce U16_GET_SUPPLEMENTARY(lead, trail) and signal width 2;
   else width 1 and the unit itself. Width is returned in a register so
   the consumer can rewind by it.

2. PatternCharacter, FixedCount, BMP char (U16_LENGTH==1): unchanged reads
   (already unit-exact). Non-BMP literal (width 2): the claim already covers
   2 units; read the pair backward and compare against the code point.
   Count loops scale by 2 (mirror of forward hasNonBMP scaling).

3. CharacterClass FixedCount:
   - hasOneCharacterSize (all BMP, or all non-BMP): static width per match
     (1 or 2), scaling like the literal case.
   - variable width (m_hasFixedSize false): read backward with dynamic width;
     after each match rewind index by width; the loop's matchAmount frame
     slot records COUNT of matches, and a parallel BEGIN INDEX slot records
     the entry index so backtracking restores exactly (mirror of forward's
     BackTrackInfoCharacterClass::beginIndex rematch approach).

4. Greedy/NonGreedy loops in Backward + unicode: each iteration reads
   backward (dynamic width), rewinds by width; backtracking rematches one
   fewer from the recorded begin index (the forward code's "Rematch one
   less" strategy already exists for variable width; the Backward variant
   walks toward higher indices instead).

5. Backreferences in a Backward body under unicode: compare unit-for-unit
   walking backward (the referenced capture is a unit range); no decode
   needed for equality, so this is direction bookkeeping only.

6. Word boundary / dot-star / assertions inside the body: read the char
   ending at the position via the backward reader (for \b the "previous"
   char is the one ending at index, the "next" is the forward read at index).

## Deletions in the same series (no gates, no compat)
- Remove: containsLookbehinds && (eitherUnicode || m_containsBOLGroupBubble)
  bailout; JITFailureReason::Lookbehind for these cases; m_containsBOLGroupBubble.
- Remove the Options I added (useRegExpAlternationFactoring,
  regExpAlternationGroupThreshold, useRegExpAlternationDispatch,
  regExpAlternationDispatchThreshold): behaviour is unconditional.
- Fix optimizeBOL/copyTerm properly so BOL-anchored groups need no gate
  (the min-0 group case must not be dropped-when-required; see D4).

## Verification
- New corpus: unicode lookbehind differential (JIT vs interpreter vs node),
  generated + hand cases with astral chars in body and subject, lone
  surrogates in subject, variable-width classes, greedy/lazy quantified
  bodies, backrefs, captures inside body.
- Existing corpora + soak vs branch jsc + bun suite vs branch build + perf
  table (the three iu/iv cliff patterns must approach their /i times).

## Bugs found during Stage-D verification (all fixed)
1. Fixed astral-literal backward loop computed the lead's address as an
   unsigned frame offset (baseOffset - 1) that underflows at the lowest
   occurrence (Checked<unsigned> crash at compile). Fix: step the count
   register down one unit and reuse the same offset.
2. jumpIfNoAvailableInput() with no count applied the FORWARD test
   (index > length) in a backward frame; a borrowed -1 satisfied it and
   produced spurious failures. Fix: backward countless form tests index < 0.
3. ParentheticalAssertionBegin's backtrack undid entry realignment
   arithmetically (sub/add checkAdjust), which is only valid when the body
   left index on the enclosing frame's coordinate line. A mirrored body in a
   forward frame (or vice versa) leaves index on its own line, so failure
   paths reconstructed a wrong outer position and the top-level scan looped
   forever. Fix: when body direction differs from the enclosing frame,
   reload the enclosing index from the assertion's beginIndex slot (a strict
   generalization -- yields the same value the undo computed on the old paths).
4. The once-class backward-unicode path grew the leftward claim by one for
   any decoded pair, but a static-width all-astral class is already laid out
   at 2 units, so it double-claimed and misaligned the assertion point (false
   negatives, e.g. /(?<=[\u{10400}\u{10428}])x/u). Fix: only variable-width
   classes extend. Also: shared-lead pair fast paths (once and greedy class)
   read the pair forward from the first unit; guarded to forward frames.

Interpreter (pre-existing, not this change): backward astral handling
differs from V8 on several unicode lookbehind shapes ((?<=\u{1F600}{2})a,
\p{Emoji_Presentation}, [\u{1F600}x]{3}); the JIT now matches V8 there.
5. jumpIfNoAvailableInput()'s countless backward form (see 2) was one half; the
   other half was found by the generated soak: nested-assertion renumbering.
   A forward lookahead nested inside a mirrored lookbehind body had its own
   body renumbered, but an assertion nested INSIDE that lookahead body kept the
   pattern layer's numbering from a discarded coordinate space; the compiler's
   checkedOffset - inputPosition then underflowed (Checked<unsigned> crash) --
   minimal repro /(?<!a(?=b(?!c{0,2})))/. Fix: assignAlternativeOffsets renumbers
   a nested FORWARD assertion's body from its own position, recursively (a nested
   lookbehind keeps its 0-based body); opCompileParentheticalAssertion resets
   checkedOffset to 0 only for backward bodies, since forward sub-bodies now sit
   on their parent's coordinate line at every depth. The mirror term-copy no
   longer renumbers (redundant with the recursion).

## Known pre-existing JSC-vs-V8 divergence (both JSC tiers agree; not this change)
- /v (unicodeSets) global iteration over an astral subject: JSC reports an empty
  lookbehind match at a unit index inside a surrogate pair (e.g. matchAll indices
  [1,2,4] on "\u{1F600}\u{1F600}") where V8 gives [2,4]. Interpreter and JIT
  identical, so it is in the shared matching/pattern layer.
6. firstCharacterAdditionalReadSize discipline (pre-existing upstream JSC bug,
   surfaced by the soak). The register means "the character at the match START
   is a non-BMP pair", but any non-BMP decode wrote it, so a peek/failed read of
   an astral character elsewhere in an alternative poisoned the start advance
   (skipping a valid astral match start). Repro on STOCK JSC: /😀|-?a/u on
   "-😀" -> null (V8/interp: index 1). Fix: only the term whose single read is
   pinned to the match start (the alternative's first once-term, before any
   term that can move the frontier) may take the index-incrementing
   first-character read variant / set the register (YarrOp::
   m_readsStartCharacter). Fixed 4 of the 5 stock failure shapes.

## Open pinned residue (pre-existing upstream, JIT-only, bounded by the matrix)
- Class-first equal-minimum alternative over-advance: astral first alternative
  + an alternative of EQUAL minimum whose optimizeAlternative-leading term is a
  non-inverted BMP class, under /u or /v: /😀|[qz]a/u on "-😀" -> null
  (correct [1,"😀"]). differential/matrix.mjs finds exactly 10 (source,flags)
  variants x 5 prefixes = the whole family; pinned in regressions.mjs as
  jit-astral-eqmin-classfirst-* (tierDependent: interpreter is correct).

## Second-round bugs (found by the fixed-build soak and the code review; all fixed)
7. Absolute-position anchor shortcuts in a nested forward body. generateAssertionBOL's
   non-multiline branch ("Erk, poison") treated `inputPosition != 0` as "input precedes
   ^", and generateAssertionWordBoundary keyed its start-edge test on `!inputPosition`.
   Both are false inside the body of an assertion nested in a lookbehind, whose
   numbering continues from a nonzero origin: /(?<=(?=^)x)y/.exec("xy") -> null and a
   \b variant read input[-1]. Fix: the anchor's real position is
   index - (checkedOffset - inputPosition); test index == checkedOffset - inputPosition
   (subsumes the poison shortcut, identical at top level).
8. A ^ inside a lookbehind (at any nesting depth, e.g. inside a lookahead nested in
   one) bubbled startsWithBOL up to the enclosing forward alternative and marked the
   pattern once-through, so it was tried only at position 0. A BOL behind the match
   never anchors it. Fix: ParenthesisContext tracks insideLookbehind() (inherited bit);
   assertionBOL sets startsWithBOL only when !insideLookbehind(). Also the {0} spelling
   of the optional-anchor withdrawal now runs before quantifyAtom's max==0 early return.
9. Shared-body mutation: mirrorAlternativeInto shallow-copied a nested forward
   assertion, so assignAlternativeOffsets renumbered the PATTERN'S OWN body; a later
   JIT bail (code size / nesting depth / alloc) byte-compiled the corrupted YarrPattern
   (interpreter wrong answers, even a spurious SyntaxError). Fix:
   copyForwardDisjunctionForMirror deep-copies nested forward assertion bodies (and the
   groups within them) so renumbering only ever touches mirror-owned terms.
10. Lazy quantified group in a mirrored body stopped re-entering: the NonGreedy
    paren "match one more" guard `index > beginIndex` is a forward progress test; a
    leftward-consuming group needs `index < beginIndex`. Fix: direction-aware branch.
11. dotAll any-character class matched a dangling surrogate under /u,/v (the
    m_anyCharacter fast path skipped the errorCodePoint rejection the inverted-class
    path has), so /(?!.)/gvs skipped mid-pair empty matches. Pre-existing, newly
    reachable; fixed by rejecting errorCodePoint in the fast path for unicode compiles.
12. m_readsStartCharacter over-applied to the head literal of a NESTED group's or
    assertion's alternative (frontierMayHaveMoved was per-call), poisoning the start
    advance: /\u{1F601}z|x(?:a)/u missed the astral match. Fix: only the pattern's own
    body alternatives beginsAtMatchStart.
13. SIGBUS: the once-class / fixed-class leftward pair-lead borrow used
    jumpIfNoAvailableInput(1), whose failure leaves index at -1 by contract; a sibling
    op (a lazy sibling's re-entry read) then addressed input through the negative
    frontier before the term's beginIndex restore. Fix: claimBackwardPairLead undoes the
    failed borrow before joining the failure jumps, so a negative frontier is never live.
14. firstCharacterAdditionalReadSize (redesign, final form). Scoping the reader inside
    generateTerm missed reads emitted in the SEPARATE backtrack pass (a greedy class's
    "rematch one less" loop re-reads through the optimizing reader with no scope active
    and wrote the register): /\s😀|\s{0,2}(?!.{1,3}^)\n/iu skipped the astral start.
    Final design: the ambient m_useFirstNonBMPCharacterOptimization is FALSE everywhere
    and turned on only while generating the start-read term (op.m_readsStartCharacter);
    eligibility lives in m_canUseFirstNonBMPCharacterOptimization, which the register's
    reset/consumer sites test. Loop peeks, nested reads, and backtrack-pass re-reads
    can therefore never write the register.

15. Backward quantified GROUPS now compile natively (final). quantifyAtom used to split a
    backward paren X{min,max} into a mandatory FixedCount copy + an optional {0,max-min}
    copy sharing one subpattern id ("the JIT's right-to-left backtracking machinery hasn't
    been generalized for single-term VariableMin"). That expansion is itself incorrect
    for the JIT: the optional copy's clearSubpattern on unwind erases the capture that the
    mandatory sibling recorded, and the sibling never re-runs its Begin, so the endpoint
    written at group entry is lost: /\w(?<=$(.?)+?)/.exec("0") -> capture null (correct
    ""). Fix at the layer that owns the invariant: parenthesized subpatterns keep a single
    PatternTerm in BOTH directions (the same native path forward always used); the
    ParenContext machinery is direction-neutral once the NonGreedy progress guard is
    direction-aware (item 10). The paren-only isCopy fix-ups in the atom expansion are
    dead and deleted, with the non-paren invariant asserted. Verified: 56-shape backward
    group matrix (bounded/unbounded, greedy/lazy, captured, nested, backrefs, negative,
    /u) JIT == interpreter == node.

16. Quantified-split capture ownership in a mirrored frame (final). Groups whose body can
    match empty keep the FixedCount{min} + optional{0,max-min} split (item 15's routing;
    the native path would punt them, bug 200786). In the mirrored frame the optional
    copy's ABANDONED iteration runs clearSubpattern on the shared capture id -- observed
    with --traceRegExpJITExecution: the copy's Begin.bt fires after the mandatory once
    committed the capture -- and control re-emerges through the mandatory group's End
    only, which rewrote just the frontier-side endpoint: [start=1, end=-1] surfaced as an
    absent capture (/\w(?<=$(.?)+?)/ -> null, correct ""). Fix at the once-group's own
    Begin/End: a mirrored capturing FixedCount group (a real once-frame owner:
    quantityMaxCount==1 && !isCopy) recomputes and saves its entry-side endpoint into its
    once-frame begin slot at Begin, and End re-establishes that endpoint before writing
    the frontier side, so every re-emergence records both. Restoring the split's isCopy
    ownership marks (mistakenly deleted as dead code before item 15's refinement sent
    parens back to the split) is what makes the JIT see the copy/mandatory relationship
    at all. Four modeled hypotheses were falsified before the execution trace made the
    control flow observable; lesson recorded in memory (trace before modeling).

17. Quantified-split capture ownership, completed (final form supersedes item 16's
    scope). The split (X{min,max} -> mandatory FixedCount + optional {0,max-min} copy
    sharing X's capture ids) applies to EVERY quantification with 0 < min < max, in both
    directions: the earlier "native for non-empty bodies" routing was inert (the body's
    m_minimumSize is not computed until setupOffsets, after parsing) and is removed. The
    ownership bug is one mechanism at every mandatory-copy End: the optional sibling's
    abandoned iteration clearSubpatterns the shared id, and control re-emerges through
    the mandatory group's End -- never its Begin -- so only the exit-side endpoint was
    rewritten (Angle A found the erased capture can even lose a backreference match:
    /([ab]?c?){1,2}?\1c/ on "abca" -> JIT null). Fixed at the layer that owns the
    invariant: quantifyAtom marks the mandatory piece with parentheses.hasCopySibling
    (markCopyOwner also marks the capturing groups directly nested in its body, which
    share the abandonment fate), and every paren End emitter (Once, FixedCount, general
    ParenContext) re-establishes a copy owner's entry-side endpoint from that iteration's
    saved start index (the once-frame begin slot / BackTrackInfoParentheses::beginIndex,
    which the Begins already store) via emitCaptureEntrySideFromSavedIndex. Direction is
    handled inside the helper (forward: start; mirrored: end). Ordinary groups
    (hasCopySibling false) compile unchanged.
18. Start-read predicate: the isLiteral narrowing of m_readsStartCharacter is removed
    (readsOnce alone; class heads qualify). An A/B build proved the narrowing neutral
    across every astral table and its comment's claimed mechanism ("stray advance on
    class-mismatch") false -- the reader only records the flag, it never moves the
    frontier. Reviewer-caught; resolved by experiment, not argument.

## Verification snapshot at end of session (final build)

- test262 built-ins/RegExp: 3754 tests, 0 failures on BOTH tiers (fresh process
  per test, so punt-immune). String regex methods (match/matchAll/replace/
  replaceAll/search/split): 676 tests, 0 failures.
- JSTests regex stress files: 234 files x 2 tiers, no engine failures (only the
  environment-dependent OOM tests and one intentionally-infinite watchdog test,
  identical on both tiers and on stock).
- LayoutTests js/regexp + fast/regex script-tests: 51 files x 2 tiers, 0 failures.
- Three ~6MB differential corpora byte-identical across tiers; 108-case corpus and
  the 7020-case generated matrix agree with node except the pinned class-first
  family (exactly 50 rows); all session probe tables agree with node.
- Punt-immune targeted split-space differential: 3140 cases (11 body shapes x 8
  quantifiers x tails x suffixed subjects + a lookbehind slice), one case per fresh
  process, 0 JIT-vs-interpreter divergence.
- Closing soaks: all divergent seeds classified; zero introduced regressions remain
  (everything either fixed or a catalogued pre-existing/shared-layer difference).
- Perf: isbot benchmark ~120 ms (stock ~32,000 ms); unicode lookbehind cliff closed
  (e.g. /iu lookbehind alternation 2212 ms -> ~106 ms).

19. markCopyOwner traversal completed (review-caught). The first version marked only
    capturing groups DIRECTLY inside the mandatory piece and claimed deeper ones were
    "marked by that group's own split" -- false for a capture inside an UNQUANTIFIED
    subgroup, which shares the cleared subpattern-id range but has no split of its own:
    /\w(?<=$(?:(?:(.?)))+?)/ on "0" -> capture null (correct ""), backward only
    (forward, the copy precedes the owner in match order, so no post-commit clobber).
    Fix: recurse through unquantified once-groups (quantityMaxCount == 1 && !isCopy),
    marking every capturing once-group in the body; nested quantified groups are
    correctly left alone (their iterations re-record through their own Begin, and nested
    splits mark their own piece). Verified against depth-2/3 mirrored shapes and the
    3140-case punt-immune split sweep (still 0 divergence, so no over-marking).

20. ROOT CAUSE OF THE WHOLE CAPTURE-OWNERSHIP CLASS (final; supersedes items 16, 17, 19).
    Every "quantified split loses a capture" case today -- backward once-copy (item 16),
    forward min>=2 (item 17's soak seeds), depth-2 nesting (item 19), earlier-sibling
    groups, nested quantified groups, assertion-nested captures (final review Angle X's
    five candidates) -- was ONE pre-existing clear at the erasure boundary: the general
    paren Begin backtrack's `noPreviousIteration` (NonGreedy) and min-count-failure
    (Greedy) paths call emitClearCapturesForTerm(term), meaning "this group ran zero
    iterations, so its captures are undefined". For the split's OPTIONAL COPY that is
    false: its capture ids belong to the mandatory sibling, whose committed values
    restoreParenContext has ALREADY restored by the time the clear runs -- the clear then
    erases them. Fix: gate both clears on !term->parentheses.isCopy. This is the site the
    morning trace pointed at ([8] Begin.bt) that was never located; the End-side
    re-establishment machinery built during the day (hasCopySibling, markCopyOwner /
    markNestedOnceGroups, emitCaptureEntrySideFromSavedIndex, three End hooks, a Begin
    store) was a downstream mitigation that repaired only groups whose End was
    re-traversed, so it kept springing leaks. An A/B build with the mitigation
    NEUTRALIZED passed every case, proving it dead defense; it is DELETED. Verified with
    the mitigation removed: all Angle X candidates, m403 family, depth-2, all sixteen
    family tables, and the 3140-case punt-immune split sweep (0 divergence).
    Lesson: a mitigation that keeps needing extension is masking the real site; when a
    reviewer names an erasure boundary, test the root fix ALONE.

21. Nested min>0 quantified groups: exponential IR + JIT crash (final review Angle Y).
    An intermediate routing sent EVERY 0<min<max quantification through the
    FixedCount{min}+optional-copy split, including forward parenthesized subpatterns.
    The split deep-copies the disjunction subtree, so nesting depth d gave ~2^d terms:
    /(?:(?:...(?:a)+)+...)+/ nested 21 deep (a 106-char pattern) killed jsc in the JIT
    (Vector<YarrOp> capacity CRASH()) and made the interpreter exponential too (both
    tiers share the YarrPattern). Fix: forward parenthesized subpatterns with min>0 keep
    a single native quantified term (opCompileParenthesesSubpattern) -- exactly stock's
    routing, restored -- while backward (lookbehind) parens keep the split their
    mirrored bodies need, plus the !isCopy erasure-boundary gate (item 20). Verified:
    depths 21/30/50 instant and correct; 500-case randomized nesting stress with 0
    divergence and 0 non-zero exits; forward-native captures (m403 family, min>=2 lazy,
    Angle X's forward cases) all agree with the interpreter and node.

22. Nested min>0 groups INSIDE A LOOKBEHIND (mirror of item 21; final review). Backward
    parens still take the split, and with it applied at every nesting level a
    lookbehind body nested 21 deep killed the JIT (Vector<YarrOp> CRASH) while the
    interpreter survived -- a JIT-only crash. The reviewer named the exact regression:
    an intermediate routing had dropped stock's m_hasCopiedParenSubexpressions guard,
    which exists precisely so that only the INNERMOST quantification splits; once the
    pattern contains any split copy, further paren quantification stays a single
    native term instead of re-copying a body that already contains copies. Restored
    verbatim (plus the Forward clause the mirror needs), so the routing is now stock's
    rule with one direction clause. Verified: lookbehind nesting depth 21/30/50 instant
    (0.06 s) and correct; forward depth 30 instant; every backward capture family whose
    outer levels now compile natively (nested {n,m} groups, depth-2, lazy-group,
    (x+)(y) shapes) agrees with the interpreter; the erasure-gate review (~18k lookbehind
    fuzz cases) and the split sweep (3140) stay at 0 divergence; test262 3754/3754 both
    tiers.
