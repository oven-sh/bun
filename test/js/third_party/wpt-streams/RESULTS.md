# WPT streams conformance results (current implementation)

Vendored from `web-platform-tests/wpt @ 1cfa3004f4ac74aa007591529aba9e9246b1f1bf`
(see `UPSTREAM.md` for the file list and exclusions). 68 `.any.js` files copied
byte-for-byte plus the `streams/resources/*.js` helpers and `common/gc.js`;
`../wpt-testharness-shim.ts` supplies the `promise_test`/`assert_*`/`t.*` surface on
top of `bun:test` and `wpt-streams.test.ts` drives every file, resolving its
`// META: script=` includes.

Recorded against the **C++ Web Streams implementation** (the rewrite that replaced
the JS-builtin implementation). Every WPT subtest that does not pass is listed in
`expectations.json` and registered as `test.failing` (its body still runs, so a
subtest that starts passing turns the suite red — the graduation signal). Everything
else must pass, so the suite is green in CI and any regression in the passing set is
caught.

```sh
# run the suite
bun bd test test/js/third_party/wpt-streams/wpt-streams.test.ts

# re-record the expectations (see the header of wpt-streams.test.ts)
WPT_STREAMS_RECORD=/tmp/wpt-streams-journal.jsonl bun bd test test/js/third_party/wpt-streams/wpt-streams.test.ts
```

Statuses: `FAIL` = assertion failed; `TIMEOUT` = the subtest never settled within
the shim's per-subtest budget (`SUBTEST_TIMEOUT_MS`); `CRASH` = the subtest aborts
the whole process and is therefore never executed, in either mode.

## Totals (debug build, linux-x64, 2026-07-03)

| | subtests | pass | fail | timeout | crash | pass % |
|---|---|---|---|---|---|---|
| **total** | **1402** | **1402** | 0 | 0 | 0 | **100%** |
| idlharness (WebIDL surface) | 228 | 228 | 0 | 0 | 0 | 100% |
| piping | 229 | 229 | 0 | 0 | 0 | 100% |
| queuing-strategies (top level) | 20 | 20 | 0 | 0 | 0 | 100% |
| readable-byte-streams | 248 | 248 | 0 | 0 | 0 | 100% |
| readable-streams | 348 | 348 | 0 | 0 | 0 | 100% |
| transform-streams | 133 | 133 | 0 | 0 | 0 | 100% |
| writable-streams | 196 | 196 | 0 | 0 | 0 | 100% |

`expectations.json` is empty: every subtest passes, none are marked expected-fail.

`idlharness.any.js` (the WebIDL surface-shape harness: interface-object descriptors,
prototype layout, method `length`/`name`, `@@toStringTag`, brand checks) runs with the
vendored `resources/idlharness.js` + `resources/webidl2/lib/webidl2.js` +
`interfaces/{streams,dom}.idl` from the same WPT commit. It is executed through a
registrar with upstream testharness semantics (its member subtests are registered
dynamically from inside its own setup `promise_test`, and its `test()` bodies rely on
running synchronously at registration), and every collected subtest is adjudicated
against `expectations.json` individually.

For comparison, the pre-rewrite implementation recorded with the same harness on the
same machine one day earlier: **971/1174 (82.7%)**, with 191 assertion failures, 10
timeouts, and 2 process-aborting crashes (`readable-byte-streams/respond-after-enqueue`,
a JSC assertion). Relative to that baseline the rewrite graduates 202 subtests and
regresses none; the crashes and timeouts are gone.

## Note on `templated.any.js` "canceling via the reader" (formerly expected-fail)

For `reader.cancel()` followed by `reader.read(view)`, the WHATWG algorithm
(`ReadableByteStreamControllerPullInto`, closed branch), the reference
implementation, Node, Deno, and Bun all resolve with `{ value: <zero-length view
over the transferred buffer>, done: true }`. The WPT subtest asserts
`assert_object_equals(r, { value: undefined, done: true })` and passes in every
browser because upstream `testharness.js`'s `assert_object_equals` recurses into
`actual[p]` whenever it is a non-null object: an empty typed array has no
enumerable own properties, so the comparison against `undefined` is vacuous.
This suite's shim was stricter than upstream (it compared the property with
`assert_equals`), which made Bun the only implementation "failing" the subtest.
The shim now ports upstream's semantics byte-for-byte (a non-empty wrong value
still fails), and the subtest passes here for the same reason it passes
everywhere else.
