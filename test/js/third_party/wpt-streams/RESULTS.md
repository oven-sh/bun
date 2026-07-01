# WPT streams conformance results (baseline: current implementation)

Vendored from `web-platform-tests/wpt @ 1cfa3004f4ac74aa007591529aba9e9246b1f1bf`
(see `UPSTREAM.md` for the file list and exclusions). 68 `.any.js` files copied
byte-for-byte plus the `streams/resources/*.js` helpers and `common/gc.js`;
`testharness-shim.ts` supplies the `promise_test`/`assert_*`/`t.*` surface on
top of `bun:test` and `wpt-streams.test.ts` drives every file, resolving its
`// META: script=` includes.

This is the **baseline of the pre-rewrite (current) Web Streams
implementation**, captured immediately before the C++ rewrite. Every WPT
subtest that does not pass today is listed in `expectations.json`: expected
assertion failures are registered as `test.failing` (their bodies still run,
so a subtest that starts passing turns the suite red — the graduation
signal), while `TIMEOUT`/`CRASH` entries are body-less `test.todo`.
Everything else must pass, so the suite is green in CI and any regression in
the passing set is caught. The 203 entries below are the compliance gap the
rewrite is expected to close.

```sh
# run the suite (green: 1162 pass, 12 todo, 0 fail; the "pass" count includes
# the 191 test.failing subtests whose bodies failed as expected)
bun bd test test/js/third_party/wpt-streams/wpt-streams.test.ts

# re-record the baseline (see the header of wpt-streams.test.ts)
WPT_STREAMS_RECORD=/root/wpt-fix-scratch/j.jsonl bun bd test test/js/third_party/wpt-streams/wpt-streams.test.ts
```

## Totals (debug build, linux-x64, 2026-07-01)

| | subtests | pass | fail | timeout | crash | pass % |
|---|---|---|---|---|---|---|
| **total** | **1174** | **971** | 191 | 10 | 2 | **82.7%** |
| piping | 229 | 226 | 3 | 0 | 0 | 98.7% |
| queuing-strategies (top level) | 20 | 18 | 2 | 0 | 0 | 90.0% |
| readable-byte-streams | 248 | 140 | 97 | 9 | 2 | 56.5% |
| readable-streams | 348 | 285 | 63 | 0 | 0 | 81.9% |
| transform-streams | 133 | 119 | 13 | 1 | 0 | 89.5% |
| writable-streams | 196 | 183 | 13 | 0 | 0 | 93.4% |

Statuses: `FAIL` = assertion failed; `TIMEOUT` = the subtest never settled
within the shim's per-subtest budget (`SUBTEST_TIMEOUT_MS`, 4500ms on
ASAN/debug builds — it must stay under bun:test's 5000ms default so the hang
is reported as a named `WPTTimeout` rather than bun killing the body);
`CRASH` = the subtest aborts the whole process (JSC `ASSERTION FAILED:
isCell()` under the debug build) and is therefore never executed, in either
mode.

## Changed by the harness fix (2026-07-01)

The runner and shim were reworked so the harness can no longer produce a
result it did not actually measure (see `wpt-streams.test.ts` /
`testharness-shim.ts`). Both baselines were recorded on the same
implementation, so every delta below is a harness-accuracy delta, not an
implementation change.

- **Subtests that moved PASS → expected-FAIL: 0.** The stricter harness
  (mandatory thenable return from `promise_test`, spec-exact
  `same_value`, hard per-file evaluation errors, hard subtest/file count
  pins) found no false passes among the 969 previously-passing subtests, and
  every one of the 191 expected-FAIL bodies (now executed via `test.failing`
  instead of skipped via `test.todo`) still fails.
- **Subtests that moved expected-FAIL → PASS: 2** — both in
  `readable-streams/patched-global.any.js`
  (`tee() should not call Promise.prototype.then()` and
  `pipeTo() should not call Promise.prototype.then()`), both previously
  recorded as `FAIL: patched then() called`. That error was thrown by the
  **old harness**, not by the implementation: the old
  `Promise.race([body, timeout])` (and its `.finally`) invoked the
  user-patched `Promise.prototype.then` on the shim's own body promise while
  the subtest still had it patched. Exercised directly (no harness), Bun's
  `tee()` and `pipeTo()` invoke the patched `then` zero times in the window
  the WPT test covers, so both subtests genuinely pass. The shim no longer
  routes any of its own bookkeeping through user-patchable prototypes.
- Total subtest count is unchanged (1174), and the TIMEOUT (10) and CRASH (2)
  sets are identical to the previous record.
- 16 `expectations.json` values changed text only (the TIMEOUT budget/wording
  and the deduplicated `assert_throws_exactly`/`promise_rejects_exactly`
  message format); none changed status.
- One deviation from upstream WPT is now documented instead of silently
  assumed: under `bun test`, `process.on("unhandledRejection")` listeners are
  never invoked (the test runner claims every unhandled rejection first), so
  the old runner's process-global no-op handler was dead code and has been
  deleted. bun:test itself already fails the owning subtest on any unhandled
  rejection — *more* strictly than WPT, which forgives a rejection that is
  handled late. That extra strictness currently causes zero failures across
  the suite (the full record sweep had zero bun-level test failures).

## Failure clusters (cause analysis)

1. **`ReadableStream.from()` is not implemented** — 37 subtests
   (`readable-streams/from.any.js`), all `ReadableStream.from is not a function`.
2. **`reader.releaseLock()` predates the 2021 spec change** — ~35 subtests.
   Releasing a reader with pending reads throws
   `There are still pending read requests, cannot release the lock`, and
   `closed` / pending `read()` promises reject with an `AbortError` instead of
   a `TypeError` (`readable-streams/{templated,default-reader}.any.js`,
   `readable-byte-streams/{general,templated}.any.js`).
3. **BYOB request bookkeeping** — ~30 subtests. `controller.byobRequest`
   returns `undefined` instead of `null`, is not invalidated after
   `respond()`/`enqueue()`, `respondWithNewView()` performs none of the
   spec-required validation (detached / zero-length / length-mismatched
   views), and `byobRequest.respond()` after `enqueue()` **crashes the
   process** (2 CRASH entries, `readable-byte-streams/respond-after-enqueue.any.js`).
4. **Byte-stream `tee()` cannot service BYOB readers** — ~28 subtests
   (`readable-byte-streams/tee.any.js`): branches reject with
   `ReadableStreamBYOBReader needs a ReadableByteStreamController`, i.e. tee
   branches of a byte stream are not themselves byte streams.
5. **`reader.read(view, { min })` is not implemented** — 18 subtests
   (`readable-byte-streams/read-min.any.js`); the option is silently ignored
   (short fills) and the argument validation rejections hang instead.
6. **`WritableStreamDefaultController.signal`/abort integration missing** —
   10 subtests (`writable-streams/aborting.any.js`).
7. **`transformer.cancel()` (2023 spec addition) not implemented** — ~12
   subtests (`transform-streams/cancel.any.js` + 2 in `errors/general`):
   cancelling the readable / aborting the writable never calls
   `transformer.cancel(reason)`.
8. **Detached/transferred ArrayBuffer handling in byte streams** — ~12
   subtests (`bad-buffers-and-views`, `enqueue-with-detached-buffer`,
   `non-transferable-buffers`): enqueuing detached or zero-length buffers must
   throw (does not), `read(view)` must transfer the buffer (it does not
   detach), reads into detached/non-transferable buffers must reject (they
   hang).
9. **Implementation is not primordial-safe** — 3 subtests
   (`*/patched-global.any.js`): `tee`/async iteration touch user-patched
   `Object.prototype` getters and a patched `getReader()`. (The two
   `... should not call Promise.prototype.then()` subtests previously listed
   here were false failures produced by the old harness itself; see
   *Changed by the harness fix* above.)
10. **Constructor / argument validation gaps** — ~15 subtests: wrong error
    class (`RangeError` where the spec says `TypeError` and vice-versa),
    non-callable `pull`/`cancel` members not rejected, `autoAllocateChunkSize:
    0`, `new WritableStreamDefaultController()` not throwing,
    `CountQueuingStrategy`/`ByteLengthQueuingStrategy` `size` function has the
    wrong `name`, async-iterator prototype has extra properties.

Smaller clusters: `pipeTo` abort does not call `underlyingSource.cancel()`
when a pull is pending (3, piping); erroring a teed stream with a cancelled
branch leaves the cancel promise unresolved (2, tee); a handful of
transform-stream error-ordering cases.

## Full list of failing subtests

Grouped by area, then file (statuses other than plain FAIL are tagged).
`expectations.json` holds the same keys with the exact assertion message.

### piping (3)

**piping/abort.any.js** — abort while a pull is pending never calls `underlyingSource.cancel()`

- (reason: 'error1: error1') underlyingSource.cancel() should called when abort, even with pending pull
- (reason: 'null') underlyingSource.cancel() should called when abort, even with pending pull
- (reason: 'undefined') underlyingSource.cancel() should called when abort, even with pending pull

### queuing-strategies (2)

**queuing-strategies.any.js** — `strategy.size.name` is `""` instead of `"size"`

- ByteLengthQueuingStrategy: size should have the right name
- CountQueuingStrategy: size should have the right name

### readable-byte-streams (108)

**readable-byte-streams/bad-buffers-and-views.any.js** — missing detached/zero-length buffer validation in `enqueue()`/`respondWithNewView()`; `read(view)` does not transfer the buffer

- ReadableStream with byte source: enqueuing a zero-length buffer throws
- ReadableStream with byte source: enqueuing a zero-length view on a non-zero-length buffer throws
- ReadableStream with byte source: enqueuing an already-detached buffer throws
- ReadableStream with byte source: read()ing from a closed stream still transfers the buffer
- ReadableStream with byte source: read()ing from a stream with queued chunks still transfers the buffer
- [TIMEOUT] ReadableStream with byte source: reading into an already-detached buffer rejects
- ReadableStream with byte source: respondWithNewView() throws if the supplied view has a larger length (in the readable state)
- ReadableStream with byte source: respondWithNewView() throws if the supplied view is non-zero-length (in the closed state)
- ReadableStream with byte source: respondWithNewView() throws if the supplied view is zero-length on a non-zero-length buffer (in the readable state)
- ReadableStream with byte source: respondWithNewView() throws if the supplied view's buffer has a different length (autoAllocateChunkSize)
- ReadableStream with byte source: respondWithNewView() throws if the supplied view's buffer has a different length (in the closed state)
- ReadableStream with byte source: respondWithNewView() throws if the supplied view's buffer has a different length (in the readable state)
- ReadableStream with byte source: respondWithNewView() throws if the supplied view's buffer has been detached (in the closed state)
- ReadableStream with byte source: respondWithNewView() throws if the supplied view's buffer has been detached (in the readable state)
- ReadableStream with byte source: respondWithNewView() throws if the supplied view's buffer is zero-length (in the closed state)
- ReadableStream with byte source: respondWithNewView() throws if the supplied view's buffer is zero-length (in the readable state)

**readable-byte-streams/general.any.js** — `byobRequest` is `undefined` instead of `null` and is not invalidated; releaseLock-with-pending-read semantics; buffers not transferred; validation gaps

- [TIMEOUT] ReadableStream with byte source: Respond to multiple pull() by separate enqueue()
- ReadableStream with byte source: Respond to pull() by enqueue()
- ReadableStream with byte source: Respond to pull() by enqueue() asynchronously
- ReadableStream with byte source: Throwing in pull function must error the stream
- ReadableStream with byte source: Throwing in pull in response to read() must be ignored if the stream is errored in it
- ReadableStream with byte source: autoAllocateChunkSize
- ReadableStream with byte source: autoAllocateChunkSize cannot be 0
- ReadableStream with byte source: autoAllocateChunkSize, releaseLock() with pending read(), read() on second reader, enqueue()
- ReadableStream with byte source: autoAllocateChunkSize, releaseLock() with pending read(), read() on second reader, respond()
- ReadableStream with byte source: autoAllocateChunkSize, releaseLock() with pending read(), read(view) on second reader, enqueue()
- ReadableStream with byte source: autoAllocateChunkSize, releaseLock() with pending read(), read(view) on second reader, respond()
- ReadableStream with byte source: enqueue() discards auto-allocated BYOB request
- ReadableStream with byte source: getReader() with mode set to byob, then releaseLock()
- ReadableStream with byte source: getReader(), then releaseLock()
- ReadableStream with byte source: pull() function is not callable
- ReadableStream with byte source: read() twice, then enqueue() twice
- ReadableStream with byte source: read(view) with 1 element Uint16Array, respond(1), releaseLock(), read() on second reader, enqueue()
- ReadableStream with byte source: read(view) with 1 element Uint16Array, respond(1), releaseLock(), read(view) on second reader with 1 element Uint16Array, respond(1)
- ReadableStream with byte source: read(view) with Uint32Array, then fill it by multiple enqueue() calls
- ReadableStream with byte source: read(view) with Uint32Array, then fill it by multiple respond() calls
- ReadableStream with byte source: read(view), then respond()
- ReadableStream with byte source: read(view), then respondWithNewView() with a transferred ArrayBuffer
- ReadableStream with byte source: releaseLock() on ReadableStreamBYOBReader must reject pending read()
- ReadableStream with byte source: releaseLock() on ReadableStreamDefaultReader must reject pending read()
- ReadableStream with byte source: releaseLock() with pending read(view), read(view) on second reader with 1 element Uint16Array, respond(1)
- ReadableStream with byte source: releaseLock() with pending read(view), read(view) on second reader with 2 element Uint8Array, respond(3)
- ReadableStream with byte source: releaseLock() with pending read(view), read(view) on second reader, close(), respond(0)
- ReadableStream with byte source: releaseLock() with pending read(view), read(view) on second reader, enqueue()
- ReadableStream with byte source: releaseLock() with pending read(view), read(view) on second reader, respond()
- ReadableStream with byte source: releaseLock() with pending read(view), read(view) on second reader, respondWithNewView()
- calling respond() should throw when canceled
- pull() resolving should not resolve read()

**readable-byte-streams/non-transferable-buffers.any.js** — WebAssembly.Memory buffers must be rejected with TypeError; reads hang instead

- ReadableStream with byte source: enqueue() with a non-transferable buffer
- [TIMEOUT] ReadableStream with byte source: fill() with a non-transferable buffer
- [TIMEOUT] ReadableStream with byte source: read() with a non-transferable buffer
- ReadableStream with byte source: respondWithNewView() with a non-transferable buffer

**readable-byte-streams/patched-global.any.js** — implementation calls a user-patched `Promise.prototype.then`

- Patched then() sees byobRequest after filling all pending pull-into descriptors

**readable-byte-streams/read-min.any.js** — `read(view, { min })` (BYOB `min` option) not implemented

- ReadableStream with byte source: 3 byte enqueue(), then close(), then read({ min }) with 2-element Uint16Array must fail
- ReadableStream with byte source: cancel() with partially filled pending read({ min }) request
- ReadableStream with byte source: enqueue(), then read({ min })
- [TIMEOUT] ReadableStream with byte source: read({ min }) rejects if min is 0
- [TIMEOUT] ReadableStream with byte source: read({ min }) rejects if min is larger than view's length (DataView)
- [TIMEOUT] ReadableStream with byte source: read({ min }) rejects if min is larger than view's length (Uint16Array)
- [TIMEOUT] ReadableStream with byte source: read({ min }) rejects if min is larger than view's length (Uint8Array)
- [TIMEOUT] ReadableStream with byte source: read({ min }) rejects if min is negative
- ReadableStream with byte source: read({ min }) when closed before view is filled
- ReadableStream with byte source: read({ min }) when closed immediately after view is filled
- ReadableStream with byte source: read({ min }) with 2-element Uint16Array, then 3 byte enqueue(), then close() must fail
- ReadableStream with byte source: read({ min }) with a DataView
- ReadableStream with byte source: read({ min }), then read()
- ReadableStream with byte source: read({ min }), then respondWithNewView() with a transferred ArrayBuffer
- ReadableStream with byte source: read({ min: 3 }) on a 3-byte Uint8Array, then multiple enqueue() up to 3 bytes
- ReadableStream with byte source: read({ min: 3 }) on a 5-byte Uint8Array, then multiple enqueue() up to 3 bytes
- ReadableStream with byte source: read({ min: 3 }) on a 5-byte Uint8Array, then multiple enqueue() up to 4 bytes
- ReadableStream with byte source: tee() with read({ min }) from branch1 and read() from branch2

**readable-byte-streams/respond-after-enqueue.any.js** — process abort (JSC `ASSERTION FAILED: isCell()`, SIGABRT) on the debug build; the WPT test exists precisely because this pattern crashed other engines

- [CRASH] byobRequest.respond() after enqueue() should not crash
- [CRASH] byobRequest.respond() with cached byobRequest after enqueue() should not crash

**readable-byte-streams/tee.any.js** — tee branches of a byte stream do not support BYOB readers (`ReadableStreamBYOBReader needs a ReadableByteStreamController`)

- ReadableStream teeing with byte source: canceling both branches in sequence with delay
- ReadableStream teeing with byte source: canceling branch1 should finish when branch2 reads until end of stream
- ReadableStream teeing with byte source: canceling branch1 should finish when original stream errors
- ReadableStream teeing with byte source: chunks for BYOB requests from branch 1 should be cloned to branch 2
- ReadableStream teeing with byte source: chunks should be cloned for each branch
- ReadableStream teeing with byte source: close when both branches have pending BYOB reads
- ReadableStream teeing with byte source: closing the original should close the branches
- ReadableStream teeing with byte source: erroring a teed stream should properly handle canceled branches
- ReadableStream teeing with byte source: erroring the original should error pending reads from BYOB reader
- ReadableStream teeing with byte source: erroring the original should immediately error the branches
- ReadableStream teeing with byte source: errors in the source should propagate to both branches
- ReadableStream teeing with byte source: failing to cancel when canceling both branches in sequence with delay
- ReadableStream teeing with byte source: pull with BYOB reader, then pull with default reader
- ReadableStream teeing with byte source: pull with default reader, then pull with BYOB reader
- ReadableStream teeing with byte source: read from branch1 and branch2, cancel branch1, cancel branch2
- ReadableStream teeing with byte source: read from branch1 and branch2, cancel branch1, respond to branch2
- ReadableStream teeing with byte source: read from branch1 and branch2, cancel branch2, cancel branch1
- ReadableStream teeing with byte source: read from branch1 and branch2, cancel branch2, enqueue to branch1
- ReadableStream teeing with byte source: read from branch1 with default reader, then close while branch2 has pending BYOB read
- ReadableStream teeing with byte source: read from branch2 with default reader, then close while branch1 has pending BYOB read
- ReadableStream teeing with byte source: read from branch2, then read from branch1
- ReadableStream teeing with byte source: reading an array with a byte offset should clone correctly
- ReadableStream teeing with byte source: respond() and close() while both branches are pulling
- ReadableStream teeing with byte source: should be able to read one branch to the end without affecting the other
- ReadableStream teeing with byte source: should not pull any chunks if no branches are reading
- ReadableStream teeing with byte source: should not pull when original is already errored
- ReadableStream teeing with byte source: should only pull enough to fill the emptiest queue
- ReadableStream teeing with byte source: stops pulling when original stream errors while both branches are reading
- ReadableStream teeing with byte source: stops pulling when original stream errors while branch 1 is reading
- ReadableStream teeing with byte source: stops pulling when original stream errors while branch 2 is reading

**readable-byte-streams/templated.any.js** — releaseLock semantics (AbortError instead of TypeError; pending reads block release); canceled BYOB read result value

- ReadableStream with byte source (empty) BYOB reader: canceling via the reader should cause the reader to act closed
- ReadableStream with byte source (empty) BYOB reader: releasing the lock should cause closed calls to reject with a TypeError
- ReadableStream with byte source (empty) BYOB reader: releasing the lock should reject all pending read requests
- ReadableStream with byte source (empty) default reader: releasing the lock should cause closed calls to reject with a TypeError
- ReadableStream with byte source (empty) default reader: releasing the lock should reject all pending read requests

### readable-streams (63)

**readable-streams/async-iterator.any.js** — async-iterator prototype shape and `return()`/cancel ordering

- Acquiring a reader and reading the remaining chunks after partially async-iterating a stream with preventCancel = true
- Async iterator instances should have the correct list of properties
- Cancellation behavior when manually calling return(); preventCancel = false
- return() rejects if the stream has errored
- return(); next() with delayed cancel()
- return(); next() with delayed cancel() [no awaiting]
- values() throws if there's already a lock

**readable-streams/default-reader.any.js** — releaseLock-with-pending-read semantics (AbortError instead of TypeError)

- Second reader can read chunks after first reader was released with pending read requests
- closed is replaced when stream closes and reader releases its lock
- closed is replaced when stream errors and reader releases its lock
- closed should be rejected after reader releases its lock (multiple stream locks)

**readable-streams/from.any.js** — `ReadableStream.from()` not implemented

- ReadableStream.from accepts a ReadableStream
- ReadableStream.from accepts a ReadableStream async iterator
- ReadableStream.from accepts a Set
- ReadableStream.from accepts a Set iterator
- ReadableStream.from accepts a string
- ReadableStream.from accepts a sync generator
- ReadableStream.from accepts a sync iterable of promises
- ReadableStream.from accepts a sync iterable of values
- ReadableStream.from accepts a sync iterable with a function iterator
- ReadableStream.from accepts an array iterator
- ReadableStream.from accepts an array of promises
- ReadableStream.from accepts an array of values
- ReadableStream.from accepts an async generator
- ReadableStream.from accepts an async iterable
- ReadableStream.from accepts an async iterable with a function iterator
- ReadableStream.from accepts an empty iterable
- ReadableStream.from ignores @@iterator if @@asyncIterator exists
- ReadableStream.from ignores a null @@asyncIterator
- ReadableStream.from re-throws errors from calling the @@asyncIterator method
- ReadableStream.from re-throws errors from calling the @@iterator method
- ReadableStream.from(array), push() to array while reading
- ReadableStream.from: calls next() after first read()
- ReadableStream.from: cancel() rejects when return() fulfills with a non-object
- ReadableStream.from: cancel() rejects when return() is not a method
- ReadableStream.from: cancel() rejects when return() rejects
- ReadableStream.from: cancel() rejects when return() throws synchronously
- ReadableStream.from: cancel() resolves when return() method is missing
- ReadableStream.from: cancelling the returned stream calls and awaits return()
- ReadableStream.from: reader.cancel() inside next()
- ReadableStream.from: reader.cancel() inside return()
- ReadableStream.from: reader.read() inside next()
- ReadableStream.from: return() is not called when iterator completes normally
- ReadableStream.from: stream errors when next() fulfills with a non-object
- ReadableStream.from: stream errors when next() rejects
- ReadableStream.from: stream errors when next() returns a non-object
- ReadableStream.from: stream errors when next() throws synchronously
- ReadableStream.from: stream stalls when next() never settles

**readable-streams/general.any.js** — constructor validation (wrong error class; non-callable members accepted); controller prototype shape

- ReadableStream can't be constructed with an invalid type
- ReadableStream constructor will not tolerate initial garbage as cancel argument
- ReadableStream constructor will not tolerate initial garbage as pull argument
- ReadableStream start controller parameter should be extensible

**readable-streams/patched-global.any.js** — implementation routes through user-patchable globals (`Object.prototype`, `getReader`)

- ReadableStream async iterator should use the original values of getReader() and ReadableStreamDefaultReader methods
- ReadableStream tee() should not touch Object.prototype properties

**readable-streams/tee.any.js**

- ReadableStream teeing: erroring a teed stream should properly handle canceled branches

**readable-streams/templated.any.js** — releaseLock-with-pending-read semantics (AbortError instead of TypeError; `closed` identity)

- ReadableStream (empty) reader: releasing the lock should cause closed calls to reject with a TypeError
- ReadableStream (empty) reader: releasing the lock should reject all pending read requests
- ReadableStream (errored via returning a rejected promise in start) reader: releasing the lock should cause closed to reject and change identity
- ReadableStream reader (closed after getting reader): releasing the lock should cause closed to reject and change identity
- ReadableStream reader (closed before getting reader): releasing the lock should cause closed to reject and change identity
- ReadableStream reader (closed via cancel after getting reader): releasing the lock should cause closed to reject and change identity
- ReadableStream reader (errored after getting reader): releasing the lock should cause closed to reject and change identity
- ReadableStream reader (errored before getting reader): releasing the lock should cause closed to reject and change identity

### transform-streams (14)

**transform-streams/cancel.any.js** — `transformer.cancel()` (2023 spec addition) not implemented

- aborting the writable side should call transformer.abort()
- aborting the writable side should reject if transformer.cancel() throws
- cancelling the readable side should call transformer.cancel()
- cancelling the readable side should reject if transformer.cancel() throws
- closing the writable side should reject if a parallel transformer.cancel() throws
- readable.cancel() and a parallel writable.close() should reject if a transformer.cancel() calls controller.error()
- readable.cancel() should not call cancel() again when already called from writable.abort()
- writable.abort() and readable.cancel() should reject if a transformer.cancel() calls controller.error()
- writable.abort() should not call cancel() again when already called from readable.cancel()
- writable.close() should not call flush() when cancel() is already called from readable.cancel()

**transform-streams/errors.any.js**

- [TIMEOUT] TransformStream transformer.start() rejected promise should error the stream
- controller.error() should close writable immediately after readable.cancel()

**transform-streams/general.any.js**

- terminate() should abort writable immediately after readable.cancel()

**transform-streams/reentrant-strategies.any.js**

- writer.abort() inside size() should work

### writable-streams (13)

**writable-streams/aborting.any.js** — `WritableStreamDefaultController.signal` not implemented

- WritableStreamDefaultController.signal
- recursive abort() call from abort() aborting signal
- recursive abort() call from abort() aborting signal (not started)
- recursive close() call from abort() aborting signal
- recursive close() call from abort() aborting signal (not started)
- the abort signal is not signalled on close failure
- the abort signal is not signalled on error
- the abort signal is not signalled on write failure
- the abort signal is signalled synchronously - close
- the abort signal is signalled synchronously - write

**writable-streams/bad-strategies.any.js**

- Writable stream: invalid strategy.highWaterMark

**writable-streams/constructor.any.js** — `new WritableStreamDefaultController()` must throw

- WritableStreamDefaultController constructor should throw
- WritableStreamDefaultController constructor should throw when passed an initialised WritableStream

## Notes on the harness

- The shim implements only the testharness surface the streams suite uses;
  `t.step()` mirrors WPT (swallow + fail-after) so that an assertion inside an
  underlying-source/sink callback does not perturb the stream machinery.
- `promise_test` bodies must return a thenable (upstream semantics); the
  shim's own bookkeeping never goes through user-patchable prototype methods.
- `garbageCollect()` (from the vendored `common/gc.js`) is wired to
  `Bun.gc(true)` via `TestUtils.gc`.
- Timed-out subtests are recorded as `TIMEOUT`, never silently skipped, and
  still run their `t.add_cleanup`s; the two crashing subtests can never be
  executed and are annotated `CRASH`.
- The runner hard-asserts the number of discovered `.any.js` files
  (`EXPECTED_FILES`) and registered subtests (`EXPECTED_SUBTESTS`), that a
  file that fails to evaluate errors loudly, and that every
  `expectations.json` key matched exactly one registered subtest, so the
  suite cannot silently shrink or accumulate stale expectations.
- Failure messages in `expectations.json` were captured with the same shim, so
  a shim artifact would show up there; spot-checking the clusters above
  against the spec confirmed they are implementation gaps, not shim gaps.
