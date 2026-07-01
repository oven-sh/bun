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

## Totals (debug build, linux-x64, 2026-07-01)

| | subtests | pass | fail | timeout | crash | pass % |
|---|---|---|---|---|---|---|
| **total** | **1174** | **1173** | 1 | 0 | 0 | **99.9%** |
| piping | 229 | 229 | 0 | 0 | 0 | 100% |
| queuing-strategies (top level) | 20 | 20 | 0 | 0 | 0 | 100% |
| readable-byte-streams | 248 | 247 | 1 | 0 | 0 | 99.6% |
| readable-streams | 348 | 348 | 0 | 0 | 0 | 100% |
| transform-streams | 133 | 133 | 0 | 0 | 0 | 100% |
| writable-streams | 196 | 196 | 0 | 0 | 0 | 100% |

For comparison, the pre-rewrite implementation recorded with the same harness on the
same machine one day earlier: **971/1174 (82.7%)**, with 191 assertion failures, 10
timeouts, and 2 process-aborting crashes (`readable-byte-streams/respond-after-enqueue`,
a JSC assertion). Relative to that baseline the rewrite graduates 202 subtests and
regresses none; the crashes and timeouts are gone.

## The one remaining expected failure

`streams/readable-byte-streams/templated.any.js :: ReadableStream with byte source
(empty) BYOB reader: canceling via the reader should cause the reader to act closed`

`read(view)` after `reader.cancel()` resolves with `{ value: <empty Uint8Array>,
done: true }` instead of `{ value: undefined, done: true }`. It passes when the file
runs in isolation and fails only in the full 68-file run (the harness runs every
file in one realm, unlike the browser WPT runner, so cross-file state can leak); the
identical failure with the identical message existed in the pre-rewrite baseline.
Tracked as a follow-up in `specs/PHASE-D-NOTES.md`.
