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
