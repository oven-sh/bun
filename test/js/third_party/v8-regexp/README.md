# V8 mjsunit regexp tests

The files in `mjsunit/` are copied unmodified from the V8 project's
`test/mjsunit/` directory, at V8 revision
`ebfc8bb7ce1cc1b2f3fc151802f5a0c3d5ea9b02`.

They are Copyright the V8 project authors and are distributed under the
BSD 3-Clause license reproduced in `LICENSE.v8`. Each file retains its
original copyright header.

## What is included

Only tests that are engine-agnostic (pure ECMAScript RegExp behaviour) are
included. V8 tests that depend on V8-internal machinery are deliberately
excluded: files using natives syntax (`%OptimizeFunctionOnNextCall` etc.),
the experimental (linear-time) regexp engine, engine tier-up counters,
V8-specific flags, or V8-only extensions (`RegExp.$1` statics ordering,
`--regexp-interpret-all`, jetstream harness files).

## How they run

`v8-regexp.test.ts` (bun) and `run-under-node.mjs` (node) both load each test
file through `mjsunit-shim.mjs`, a from-scratch implementation of the small
subset of V8's mjsunit assert API these tests use (`assertEquals`,
`assertTrue`, `assertFalse`, `assertThrows`, `assertNull`, ...). Running the
same suite under node gives an oracle: any file that passes under node and
fails under bun is a bun/JSC regression, not a test bug.

    bun test test/js/third_party/v8-regexp/v8-regexp.test.ts
    node test/js/third_party/v8-regexp/run-under-node.mjs
