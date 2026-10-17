# Known bun (JSC) vs V8 divergences surfaced by this corpus

Each entry was reproduced on stock bun 1.3.14 and cross-checked against
node 22 / V8. These are pre-existing engine differences, tracked here so the
suite records them explicitly rather than silently masking them.

## 1. v-mode + ignoreCase: class strings not case-folded before set subtraction

File: `mjsunit/regexp-modifiers.js`

```js
/Foo(B[\q{ĀĂĄ|AaA}--\q{āăą}])r/vi.test("FooBĀĂĄr")
// V8 (spec): false  -- \q{ĀĂĄ} case-folds to āăą, so the subtraction removes it
// JSC:       true   -- subtraction applied to the unfolded strings
```

With the `i` flag in UnicodeSets mode, class-string operands are canonicalized
by case folding before class set operations are applied; JSC skips the fold.

## 2. RegExp literal early errors deferred inside lazily-parsed function bodies

File: `mjsunit/regexp-unicode-sets.js` (line: `assertEarlyError('/[^\\q{}]/v')`)

```js
new Function("return /[^\\q{}]/v")           // both engines: SyntaxError (correct)
(0, eval)("function f() { /[^\\q{}]/v }")     // V8: SyntaxError, JSC: no error until f is parsed/run
```

An invalid RegExp literal is an early error for the enclosing script; JSC's
lazy function parsing does not validate the pattern in uncalled inner
functions.

## 3. Interpreter-only: `^` alternative breaks leftmost-alternative-wins

Found by the differential harness (see test/js/web/regex/differential).
Reproduces only on JSC's bytecode interpreter path (patterns the JIT
declines, or with the JIT disabled):

```js
/a|ab|^a/.exec("xabc")   // JIT + V8: ["a"];  JSC interpreter: ["ab"]
```

## 4. JIT-only: `\B` followed by an optional group containing `^` never matches

Found by the differential harness. Reproduces on the JIT path only (the
bytecode interpreter is correct); present in stock bun.

```js
/\B(?:^)?/.exec("xx")     // V8 + JSC interpreter: [""] at index 1;  JSC JIT: null
/\B(?:^x)??/.exec("xx")   // same: [""] at index 1;                    JSC JIT: null
/\B(?:x)??/.exec("xx")    // control without ^: both give [""] at index 1
```

`\B` holds between two word characters, and the group is optional and may
match empty, so a match must exist at index 1. The JIT loses it whenever a `^`
assertion sits inside an optional/lazy group following an earlier term.

## 5. `v`-mode lookbehind steps one code unit instead of one code point

Found by the differential harness; reproduces on stock bun (all engine
tiers). Surrogate pairs must be consumed as a single code point in
UnicodeSets mode, including when matching backwards inside a lookbehind:

```js
/(?<=.)/v.exec("😀😀")      // V8: [""] at index 2;  JSC: [""] at index 1 (inside the pair)
/\B(?<=.)/v.exec("😀😀")    // V8: index 2;         JSC: index 1
```

## 6. `/gi` alternation with empty lookbehind alternative + surrogate: spurious capture in `match`

Not yet fully reduced; the original generated reproducer is kept as a tracked
case in the differential corpus (regressions.mjs, case "surrogate-empty-lookbehind"):

```js
"prefix a/😀1999 suffix".match(/\bx??(?:7|[0](?<grp>){0,2}|(?<!\w)|\n[^a-fx\w]{0})|.\/(?:(?:\1)(?:\1)*|(?:(?<=|\t{2,} \r)😀1?)\w{1,3}?|^|)/gi)
// V8: ["","","",""]   JSC: ["","a/","",""]
```

## 7. (Fixed upstream) capture not cleared by an empty iteration of a quantified group

Stock bun 1.3.14 keeps a stale empty capture; newer JSC (WebKit main as of
2026-07) and V8 report the group as not-participating:

```js
/(.*){0,2}\1/.exec("ab")   // bun 1.3.14: ["",""];  V8 + newer JSC: ["",undefined]
```

## 8. (Fixed upstream) `+` loop over alternation with quantified class + boundary, counted capture

Wrong in bun's currently-pinned JSC (JIT tier), correct in WebKit main and V8.
Found by the differential harness (case reduced from a generated pattern):

```js
/(?:\D{0,2}\b|(.){2,})+f/i.exec("f-")   // V8 + newer JSC: ["f", undefined];  bun 1.3.14: null
```

The counted capture `(.){2,}` in the second alternative is essential; a plain
`(y)` there does not trigger it.

## 9. JIT-only, live on WebKit main: optional group containing only `^` never matches

Found by the differential harness. The bytecode interpreter and V8 agree; the
JIT returns null:

```js
/(?:^)?a/.exec("ba")     // V8 + JSC interpreter: ["a", 1];  JSC JIT: null
/(?:^)*a/.exec("ba")     // same
/\B(?:^)?/.exec("xx")    // V8 + interp: [""] at 1;         JSC JIT: null
```

Not triggered when the group has other content (`/(?:^|z)?a/`) or is not the
first term of the alternative (`/x(?:^)?a/`), pointing at the zero-length-match
handling of a quantified group whose only term is an assertion. #4 above is the
same family reached through `\B`.

## 10. JIT-only, live on WebKit main: astral alternative lost next to a broad-class sibling (`/u`)

Found by the differential harness. In unicode mode, an alternative that
starts with an astral (non-BMP) literal is never matched when a sibling
alternative starts with a broad or inverted class (`\P{L}`, `[^...]`, `.`);
the JIT even prefers the later alternative's later match:

```js
/😀|\P{L}y/u.exec("z 😀0 q")     // V8 + JSC interpreter: ["😀", 2];   JSC JIT: null
/😀.|.y/u.exec("z 😀0 q")        // V8 + interp: ["😀0", 2];             JSC JIT: null
/😀.|\P{L}q/u.exec("z 😀0 q")    // V8 + interp: ["😀0", 2];             JSC JIT: [" q", 5]
```

Fine when the sibling starts with an ASCII literal (`/😀.|xy/u`) or the same
category (`\p{L}`), implicating the JIT's non-BMP first-character lead search.

## 11. bun runtime (not the regex engine): lost newline in console.log to a redirected stdout

Found while building the soak: a stream of many long `console.log` lines to a
redirected stdout lost one line's trailing newline (fusing two records); the
same content written through node:fs or a single stdout write is intact.
Deterministic reproducer and analysis are in the PR description; tracked
separately from the regex work.

## 12. `v`+`i`: negated property escape is complemented before case folding

From the V8 fix-history corpus. In UnicodeSets mode with ignoreCase, a
negated property class must have its case-fold closure applied before
complementation ("early case folding"); JSC complements first:

```js
/^\P{Lowercase}/iv.test("A")   // V8: false (A folds to lowercase a, excluded);  JSC: true
```

Same family as #1 (folding order under `v`+`i`).

## 13. `v`-mode class string disjunction: empty string preferred over longer alternatives

From the V8 fix-history corpus. `\q{...}` alternatives inside a class match
longest-first, so the empty string can only match when nothing else does:

```js
/[\q{W|}a-c]/v.exec("abc")   // V8: ["a"];  JSC: [""] (empty string chosen first)
```

## 14. Very large quantifier bounds: SyntaxError in JSC, clamped/accepted by V8

```js
/a{111111111111111111111111111111111111111111111}/.test("b")   // V8: false;  JSC: SyntaxError
/(A{9999999999}B|C*)*/.exec("C")                                // V8: ["C","C"];  JSC: SyntaxError
```

The regex grammar puts no upper bound on quantifier digits; V8's own history
treats acceptance (with clamping) as the fix for an overflow bug. JSC rejects
on overflow. Implementation-limit territory; recorded rather than asserted as a
bug in either engine.

## 15. Fixed on WebKit main (still shipping in bun 1.3.14): loop/backref/lookaround cases

The overnight soak found ten further divergences (lazy counted loops with
nested captures, over-matching with backrefs+lookahead, `\B`/lookbehind
capture participation in `split`, and three catastrophic-backtracking cliffs
where JSC 1.3.14 exceeds a 4s budget on inputs V8 handles instantly) that all
reproduce on bun 1.3.14 but are FIXED on current WebKit main. Representative:

```js
"xxx00Ωc-100Ωc-18".match(/[xa_]{1,3}(0{2}(Ω[c]-)[0-9z\w]+|\t{0}(?:.|(?:\1)x[ca])){0,2}?8/gi)
// V8 + newer JSC: ["xxx00Ωc-100Ωc-18"];  bun 1.3.14: null  (only the LAZY {0,2}? fails)
```

These are strong evidence for the value of the WebKit bump; the pinned corpus
(regressions.mjs) will confirm each is fixed when it lands.

## 16. Live (WebKit main): named group + lazy nullable loop + \k backref (needs reduction)

Reproduces only through the differential runner (transcription-sensitive
combining character in the source):

    node test/js/web/regex/differential/run.mjs --seed 460 --index 1117
    bun  test/js/web/regex/differential/run.mjs --seed 460 --index 1117 --capabilities '<hdr>'
    // pattern /(?:(?:(?<π>.?|́{1,3}|[^é](?:\k<π>){1,3}\W){2}||.7|){2}?)+?\S(?:a[9a-f]{0,2}?|\s+?\k<π>)|.?|/m
    // input "prefix  suffix": V8 exec -> ["prefix ", ""] with groups {π:""}; JSC (all tiers, incl. main) -> null

## Status update

The optional/quantified-`^`-group family (#4, #9) and the encoding-dependent
lookbehind behaviour are fixed on the oven-sh/WebKit branch of PR #299
(root cause: BOL bubbling in atomParenthesesEnd + quantifyAtom), pending the
next WebKit bump in bun; the pinned corpus will flip those entries to passes
automatically when it lands.
