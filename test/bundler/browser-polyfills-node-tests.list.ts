// Written by `BROWSER_POLYFILLS_UPDATE=1 bun bd test test/bundler/browser-polyfills-node-tests.test.ts`.
// Do not edit it by hand. browser-polyfills-node-tests.test.ts says which files are here.

// Each of these files of test/js/node/test/parallel passes as a browser bundle.
export const passing: string[] = [
  "test-buffer-ascii.js",
  "test-buffer-badhex.js",
  "test-buffer-bigint64.js",
  "test-buffer-failed-alloc-typed-arrays.js",
  "test-buffer-fakes.js",
  "test-buffer-inheritance.js",
  "test-buffer-iterator.js",
  "test-buffer-nopendingdep-map.js",
  "test-buffer-of-no-deprecation.js",
  "test-buffer-slice.js",
  "test-buffer-swap.js",
  "test-buffer-tojson.js",
  "test-buffer-zero-fill-reset.js",
  "test-buffer-zero-fill.js",
  "test-event-emitter-check-listener-leaks.js",
  "test-event-emitter-modify-in-emit.js",
  "test-event-emitter-num-args.js",
  "test-next-tick-doesnt-hang.js",
  "test-next-tick-domain.js",
  "test-next-tick-intentional-starvation.js",
  "test-next-tick-ordering.js",
  "test-next-tick-ordering2.js",
  "test-querystring-maxKeys-non-finite.js",
  "test-stream-duplex-props.js",
  "test-stream-pipe-cleanup.js",
  "test-stream-pipe-event.js",
  "test-stream-readable-setEncoding-null.js",
  "test-stream-set-default-hwm.js",
  "test-stream-transform-split-highwatermark.js",
  "test-stream-writable-invalid-chunk.js",
  "test-stream-writable-needdrain-state.js",
  "test-stream-writable-properties.js",
  "test-stream-write-drain.js",
  "test-stream2-finish-pipe-error.js",
  "test-stream2-readable-wrap-destroy.js",
  "test-stream3-pause-then-read.js",
];

// Each of these fails. Above a file, or a run of files: what it prints first.
export const failing: string[] = [
  // TypeError: undefined is not an object
  "test-assert-async.js",
  // TypeError: undefined is not a constructor (evaluating 'new CallTracker')
  "test-assert-calltracker-calls.js",
  "test-assert-calltracker-report.js",
  "test-assert-calltracker-verify.js",
  // TypeError: undefined is not an object
  "test-buffer-arraybuffer.js",
  // AssertionError: Missing expected exception.
  "test-buffer-compare-offset.js",
  // TypeError: undefined is not an object
  "test-buffer-compare.js",
  "test-buffer-concat.js",
  // TypeError: assert is not a function. (In 'assert(MAX_STRING_LENGTH <= MAX_LENGTH)', 'assert' is an instance o…
  "test-buffer-constants.js",
  // TypeError: undefined is not an object
  "test-buffer-copy.js",
  // TypeError: Argument must be a Buffer
  "test-buffer-equals.js",
  // TypeError: assert is not a function. (In 'assert(offset <= buf2.length)', 'assert' is an instance of Object)
  "test-buffer-fill.js",
  // TypeError: assert is not a function. (In 'assert(b.includes("a"))', 'assert' is an instance of Object)
  "test-buffer-includes.js",
  // TypeError: undefined is not an object
  "test-buffer-indexof.js",
  // TypeError: Attempted to assign to readonly property.
  "test-buffer-inspect.js",
  // TypeError: char.charCodeAt is not a function. (In 'char.charCodeAt(0)', 'char.charCodeAt' is undefined)
  "test-buffer-isascii.js",
  // TypeError: undefined is not an object
  "test-buffer-isencoding.js",
  // error: isUtf8 is not implemented for node:buffer browser polyfill
  "test-buffer-isutf8.js",
  // TypeError: undefined is not an object
  "test-buffer-new.js",
  "test-buffer-no-negative-allocation.js",
  "test-buffer-over-max-length.js",
  // TypeError: assert is not a function. (In 'assert(new Buffer(0).parent instanceof ArrayBuffer)', 'assert' is a…
  "test-buffer-parent-property.js",
  // TypeError: undefined is not an object
  "test-buffer-prototype-inspect.js",
  "test-buffer-read.js",
  // AssertionError: Missing expected exception.
  "test-buffer-readdouble.js",
  "test-buffer-readfloat.js",
  // AssertionError: Missing expected exception (TypeError).
  "test-buffer-readint.js",
  "test-buffer-readuint.js",
  // TypeError: assert is not a function. (In 'assert(isZeroFilled(safe))', 'assert' is an instance of Object)
  "test-buffer-safe-unsafe.js",
  // TypeError: undefined is not an object
  "test-buffer-set-inspect-max-bytes.js",
  // TypeError: The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type object
  "test-buffer-sharedarraybuffer.js",
  // TypeError: assert is not a function. (In 'assert(sb instanceof Buffer2)', 'assert' is an instance of Object)
  "test-buffer-slow.js",
  // TypeError: Unknown encoding: base64url
  "test-buffer-tostring-range.js",
  // AssertionError: Expected values to be strictly deep-equal: Comparison { - code: 'ERR_UNKNOWN_ENCODING',
  "test-buffer-tostring.js",
  // TypeError: undefined is not an object
  "test-buffer-write.js",
  // TypeError: Argument must be a Buffer
  "test-buffer-writedouble.js",
  "test-buffer-writefloat.js",
  "test-buffer-writeint.js",
  // AssertionError: Missing expected exception.
  "test-buffer-writeuint.js",
  // TypeError: assert is not a function. (In 'assert(isZeroFilled(Buffer2.allocUnsafe(1024)))', 'assert' is an in…
  "test-buffer-zero-fill-cli.js",
  // TypeError: randomBytes2 is not a function. (In 'randomBytes2(8)', 'randomBytes2' is undefined)
  "test-domain-crypto.js",
  // TypeError: Object is not a constructor (evaluating 'new EventEmitter')
  "test-domain-ee-error-listener.js",
  "test-event-emitter-add-listeners.js",
  // TypeError: Object is not a constructor (evaluating 'new (init_events(), __toCommonJS(exports_events))')
  "test-event-emitter-emit-context.js",
  // TypeError: Object is not a constructor (evaluating 'new EventEmitter')
  "test-event-emitter-error-monitor.js",
  "test-event-emitter-errors.js",
  "test-event-emitter-get-max-listeners.js",
  // AssertionError: event.on('foo', null) should throw the proper error
  "test-event-emitter-invalid-listener.js",
  // TypeError: Object is not a constructor (evaluating 'new EventEmitter')
  "test-event-emitter-listener-count.js",
  // TypeError: assert is not a function. (In 'assert(Array.isArray(fl))', 'assert' is an instance of Object)
  "test-event-emitter-listeners-side-effects.js",
  // TypeError: undefined is not an object
  "test-event-emitter-listeners.js",
  // MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 2 null listeners added to [EventEmit…
  "test-event-emitter-max-listeners-warning-for-null.js",
  // MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 2 Symbol(symbol) listeners added to …
  "test-event-emitter-max-listeners-warning-for-symbol.js",
  // MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 2 event-type listeners added to [Fak…
  "test-event-emitter-max-listeners-warning.js",
  // AssertionError: Missing expected exception (RangeError).
  "test-event-emitter-max-listeners.js",
  // TypeError: undefined is not an object
  "test-event-emitter-method-names.js",
  // TypeError: assert is not a function. (In 'assert(er instanceof Error, "error created")', 'assert' is an insta…
  "test-event-emitter-no-error-provided-to-error-event.js",
  // TypeError: Object is not a constructor (evaluating 'new EventEmitter')
  "test-event-emitter-once.js",
  "test-event-emitter-prepend.js",
  // TypeError: undefined is not an object
  "test-event-emitter-remove-all-listeners.js",
  // TypeError: Object is not a constructor (evaluating 'new EventEmitter')
  "test-event-emitter-remove-listeners.js",
  // TypeError: assert is not a function. (In 'assert(!(e._events instanceof Object))', 'assert' is an instance of…
  "test-event-emitter-set-max-listeners-side-effects.js",
  // TypeError: Object is not a constructor (evaluating 'new EventEmitter')
  "test-event-emitter-special-event-names.js",
  // TypeError: assert is not a function. (In 'assert(!(myee._events instanceof Object))', 'assert' is an instance…
  "test-event-emitter-subclass.js",
  // TypeError: Object is not a constructor (evaluating 'new EventEmitter')
  "test-event-emitter-symbols.js",
  // TypeError: The superclass is not a constructor.
  "test-eventemitter-asyncresource.js",
  // TypeError: undefined is not an object
  "test-events-getmaxlisteners.js",
  // TypeError: Object is not a constructor (evaluating 'new EventEmitter')
  "test-events-list.js",
  "test-events-listener-count-with-listener.js",
  // TypeError: on is not a function. (In 'on(ee, "foo")', 'on' is undefined)
  "test-events-on-async-iterator.js",
  // TypeError: undefined is not an object
  "test-events-once.js",
  // TypeError: emitter.listeners is not a function. (In 'emitter.listeners(type)', 'emitter.listeners' is undefin…
  "test-events-static-geteventlisteners.js",
  // AssertionError: Missing expected exception (TypeError).
  "test-next-tick-errors.js",
  // TypeError: setImmediate is not a function. (In 'setImmediate(common.mustNotCall())', 'setImmediate' is undefi…
  "test-next-tick-fixed-queue-regression.js",
  // TypeError: process.exit is not a function. (In 'process.exit()', 'process.exit' is undefined)
  "test-next-tick-when-exiting.js",
  // TypeError: undefined is not an object
  "test-next-tick.js",
  // TypeError: undefined is not an object (evaluating '(void 0).basename')
  "test-path-basename.js",
  // TypeError: undefined is not an object (evaluating '(void 0).dirname')
  "test-path-dirname.js",
  // TypeError: undefined is not an object (evaluating '(void 0).extname')
  "test-path-extname.js",
  // TypeError: undefined is not an object (evaluating 'path[platform].matchesGlob')
  "test-path-glob.js",
  // TypeError: undefined is not an object (evaluating '(void 0).isAbsolute')
  "test-path-isabsolute.js",
  // TypeError: undefined is not an object (evaluating '(void 0).join')
  "test-path-join.js",
  // TypeError: path2.toNamespacedPath is not a function. (In 'path2.toNamespacedPath("")', 'path2.toNamespacedPat…
  "test-path-makelong.js",
  // TypeError: undefined is not an object (evaluating '(void 0).normalize')
  "test-path-normalize.js",
  // TypeError: undefined is not an object (evaluating 'path2.parse')
  "test-path-parse-format.js",
  // TypeError: undefined is not an object (evaluating '(void 0).cwd')
  "test-path-posix-relative-on-windows.js",
  // TypeError: undefined is not an object (evaluating '(void 0).relative')
  "test-path-relative.js",
  // TypeError: undefined is not an object (evaluating '(void 0).join')
  "test-path-zero-length-strings.js",
  // TypeError: undefined is not an object
  "test-path.js",
  // Mismatched noop function calls. Expected exactly 2, actual 4.
  "test-process-next-tick.js",
  // TypeError: (void 0) is not a function. (In '(void 0)("\xFC")', '(void 0)' is undefined)
  "test-punycode.js",
  // TypeError: undefined is not an object
  "test-querystring-escape.js",
  // TypeError: assert is not a function. (In 'assert(!(actual instanceof Object))', 'assert' is an instance of Ob…
  "test-querystring-multichar-separator.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-readable-from-iterator-closing.js",
  // TypeError: lazyWebStreams().newStreamReadableFromReadableStream is not a function. (In 'lazyWebStreams().newS…
  "test-readable-from-web-enqueue-then-close.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-readable-from.js",
  "test-readable-large-hwm.js",
  "test-readable-single-end.js",
  "test-stream-auto-destroy.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-await-drain-writers-in-synchronously-recursion-write.js",
  "test-stream-backpressure.js",
  "test-stream-big-packet.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-big-push.js",
  "test-stream-catch-rejections.js",
  "test-stream-compose-operator.js",
  "test-stream-compose.js",
  "test-stream-construct.js",
  "test-stream-decoder-objectmode.js",
  // Mismatched <anonymous> function calls. Expected exactly 1, actual 0.
  "test-stream-destroy-event-order.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-drop-take.js",
  "test-stream-duplex-destroy.js",
  "test-stream-duplex-end.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-duplex-readable-end.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-duplex-readable-writable.js",
  // TypeError: assert is not a function. (In 'assert(Object.hasOwn(Duplex.prototype, "writableFinished"))', 'asse…
  "test-stream-duplex-writable-finished.js",
  // TypeError: duplexPair is not a function. (In 'duplexPair()', 'duplexPair' is undefined)
  "test-stream-duplexpair.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-end-of-streams.js",
  "test-stream-end-paused.js",
  "test-stream-err-multiple-callback-construction.js",
  "test-stream-error-once.js",
  "test-stream-event-names.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-events-prepend.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-forEach.js",
  // TypeError: assert is not a function. (In 'assert(!(new OtherCustomWritable instanceof CustomWritable))', 'ass…
  "test-stream-inheritance.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-ispaused.js",
  "test-stream-objectmode-undefined.js",
  "test-stream-once-readable-pipe.js",
  "test-stream-passthrough-drain.js",
  "test-stream-pipe-after-end.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-pipe-await-drain-manual-resume.js",
  "test-stream-pipe-await-drain-push-while-write.js",
  "test-stream-pipe-await-drain.js",
  "test-stream-pipe-cleanup-pause.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-pipe-deadlock.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-pipe-error-handling.js",
  // TypeError: undefined is not an object
  "test-stream-pipe-error-unhandled.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-pipe-flow-after-unpipe.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-pipe-flow.js",
  // TypeError: setImmediate is not a function. (In 'setImmediate(() => throwCodeInbetween(rs, ws))', 'setImmediat…
  "test-stream-pipe-manual-resume.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-pipe-multiple-pipes.js",
  "test-stream-pipe-needDrain.js",
  "test-stream-pipe-objectmode-to-non-objectmode.js",
  "test-stream-pipe-same-destination-twice.js",
  "test-stream-pipe-unpipe-streams.js",
  // TypeError: emitter.listenerCount is not a function. (In 'emitter.listenerCount(type)', 'emitter.listenerCount…
  "test-stream-pipe-without-listenerCount.js",
  // TypeError: undefined is not an object
  "test-stream-pipeline-async-iterator.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-pipeline-duplex.js",
  // TypeError: undefined is not an object
  "test-stream-pipeline-listeners.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-pipeline-queued-end-in-destroy.js",
  // TypeError: undefined is not an object
  "test-stream-pipeline-uncaught.js",
  // Mismatched noop function calls. Expected exactly 1, actual 0.
  "test-stream-pipeline-with-empty-string.js",
  // TypeError: undefined is not an object
  "test-stream-push-order.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-push-strings.js",
  "test-stream-readable-aborted.js",
  "test-stream-readable-add-chunk-during-data.js",
  "test-stream-readable-compose.js",
  "test-stream-readable-constructor-set-methods.js",
  "test-stream-readable-data.js",
  // AssertionError: Missing expected exception.
  "test-stream-readable-default-encoding.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-readable-destroy.js",
  "test-stream-readable-didRead.js",
  "test-stream-readable-dispose.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-readable-emit-readable-short-stream.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-readable-emittedReadable.js",
  "test-stream-readable-end-destroyed.js",
  // TypeError: assert is not a function. (In 'assert(Object.hasOwn(Readable.prototype, "readableEnded"))', 'asser…
  "test-stream-readable-ended.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-readable-error-end.js",
  "test-stream-readable-event.js",
  // TypeError: undefined is not an object
  "test-stream-readable-flow-recursion.js",
  // TypeError: lazyWebStreams().newReadableStreamFromStreamReadable is not a function. (In 'lazyWebStreams().newR…
  "test-stream-readable-from-web-termination.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-readable-hwm-0-async.js",
  "test-stream-readable-hwm-0-no-flow-data.js",
  "test-stream-readable-hwm-0.js",
  "test-stream-readable-infinite-read.js",
  // Mismatched <anonymous> function calls. Expected exactly 1, actual 0.
  "test-stream-readable-invalid-chunk.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-readable-needReadable.js",
  "test-stream-readable-next-no-null.js",
  "test-stream-readable-no-unneeded-readable.js",
  "test-stream-readable-object-multi-push-async.js",
  "test-stream-readable-pause-and-resume.js",
  "test-stream-readable-readable-one.js",
  "test-stream-readable-readable-then-resume.js",
  "test-stream-readable-readable.js",
  "test-stream-readable-reading-readingMore.js",
  "test-stream-readable-resume-hwm.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-readable-resumeScheduled.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-readable-setEncoding-existing-buffers.js",
  // TypeError: lazyWebStreams().newReadableStreamFromStreamReadable is not a function. (In 'lazyWebStreams().newR…
  "test-stream-readable-strategy-option.js",
  // TypeError: undefined is not an object
  "test-stream-readable-to-web-byob.js",
  // TypeError: lazyWebStreams().newReadableStreamFromStreamReadable is not a function. (In 'lazyWebStreams().newR…
  "test-stream-readable-to-web-termination-byob.js",
  // TypeError: (void 0) is not a function. (In '(void 0)()', '(void 0)' is undefined)
  "test-stream-readable-to-web.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-readable-unshift.js",
  // Mismatched <anonymous> function calls. Expected exactly 1, actual 0.
  "test-stream-readable-with-unimplemented-_read.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-readableListening-state.js",
  "test-stream-reduce.js",
  "test-stream-toArray.js",
  "test-stream-transform-callback-twice.js",
  "test-stream-transform-constructor-set-methods.js",
  "test-stream-transform-destroy.js",
  "test-stream-transform-final-sync.js",
  "test-stream-transform-final.js",
  "test-stream-transform-flush-data.js",
  "test-stream-transform-hwm0.js",
  "test-stream-transform-objectmode-falsey-value.js",
  // TypeError: assert is not a function. (In 'assert(parser._readableState.objectMode)', 'assert' is an instance …
  "test-stream-transform-split-objectmode.js",
  // TypeError: The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received an in…
  "test-stream-typedarray.js",
  // TypeError: assert is not a function. (In 'assert(chunk instanceof Buffer)', 'assert' is an instance of Object)
  "test-stream-uint8array.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream-unpipe-event.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-unshift-empty-chunk.js",
  "test-stream-unshift-read-race.js",
  "test-stream-writable-aborted.js",
  "test-stream-writable-change-default-encoding.js",
  // TypeError: setImmediate is not a function. (In 'setImmediate(cb)', 'setImmediate' is undefined)
  "test-stream-writable-clear-buffer.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-writable-constructor-set-methods.js",
  // TypeError: assert is not a function. (In 'assert(isBuffer)', 'assert' is an instance of Object)
  "test-stream-writable-decoded-encoding.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-writable-destroy.js",
  // TypeError: setImmediate is not a function. (In 'setImmediate(callback)', 'setImmediate' is undefined)
  "test-stream-writable-end-cb-error.js",
  // TypeError: undefined is not an object
  "test-stream-writable-end-cb-uncaught.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-writable-end-multiple.js",
  "test-stream-writable-ended-state.js",
  // Mismatched noop function calls. Expected exactly 1, actual 0.
  "test-stream-writable-final-destroy.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-writable-final-throw.js",
  "test-stream-writable-finish-destroyed.js",
  "test-stream-writable-finished-state.js",
  // TypeError: assert is not a function. (In 'assert(Object.hasOwn(Writable.prototype, "writableFinished"))', 'as…
  "test-stream-writable-finished.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream-writable-null.js",
  "test-stream-writable-writable.js",
  "test-stream-writable-write-cb-error.js",
  "test-stream-writable-write-cb-twice.js",
  "test-stream-writable-write-error.js",
  "test-stream-writable-write-writev-finish.js",
  "test-stream-writableState-ending.js",
  "test-stream-writableState-uncorked-bufferedRequestCount.js",
  "test-stream-write-destroy.js",
  "test-stream-write-final.js",
  "test-stream-writev.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream2-base64-single-char-read-end.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream2-basic.js",
  "test-stream2-compatibility.js",
  "test-stream2-decode-partial.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream2-finish-pipe.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream2-large-read-stall.js",
  "test-stream2-objects.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream2-pipe-error-handling.js",
  "test-stream2-pipe-error-once-listener.js",
  // readStart TypeError: assert is not a function. (In 'assert(reading)', 'assert' is an instance of Object)
  "test-stream2-push.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream2-read-correct-num-bytes-in-utf8.js",
  "test-stream2-read-sync-stack.js",
  "test-stream2-readable-empty-buffer-no-eof.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream2-readable-legacy-drain.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream2-readable-non-empty-end.js",
  "test-stream2-readable-wrap-empty.js",
  // Mismatched <anonymous> function calls. Expected exactly 1, actual 0.
  "test-stream2-readable-wrap-error.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream2-readable-wrap.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream2-set-encoding.js",
  "test-stream2-transform.js",
  // TypeError: undefined is not an object (evaluating 'process.stdout')
  "test-stream2-unpipe-drain.js",
  "test-stream2-unpipe-leak.js",
  // TypeError: assert is not a function. (In 'assert(tw.writableLength >= 50)', 'assert' is an instance of Object)
  "test-stream2-writable.js",
  // TypeError: undefined is not an object (evaluating 'process.nextTick')
  "test-stream3-cork-end.js",
  "test-stream3-cork-uncork.js",
  "test-streams-highwatermark.js",
  // error: Unknown encoding: base64url
  "test-string-decoder-end.js",
  // AssertionError: Expected "\ufffd\u41", but got "\ufffd\ufffd\u41" input: f0,b8,41 Write sequence: [[0,3]] Ful…
  "test-string-decoder.js",
  // TypeError: undefined is not an object
  "test-sys.js",
  // TypeError: domainToASCII2 is not a function. (In 'domainToASCII2(domain)', 'domainToASCII2' is undefined)
  "test-url-domain-ascii-unicode.js",
  // TypeError: undefined is not an object
  "test-url-format-whatwg.js",
  // AssertionError: wonky format({"protocol":"http:","hostname":"[::]","pathname":"/"}) == http://[::]/ actual: h…
  "test-url-format.js",
  // TypeError: undefined is not an object
  "test-url-invalid-file-url-path-input.js",
  // TypeError: Invalid URL
  "test-url-parse-format.js",
  // TypeError: undefined is not an object
  "test-url-parse-invalid-input.js",
  // AssertionError: http://example.com actual['search'] !== expected['search']: !== null
  "test-url-parse-query.js",
  // TypeError: (void 0) is not a function. (In '(void 0)("test/")', '(void 0)' is undefined)
  "test-url-pathtofileurl.js",
  // TypeError: Invalid URL
  "test-url-relative.js",
  // TypeError: urlToHttpOptions is not a function. (In 'urlToHttpOptions(urlObj)', 'urlToHttpOptions' is undefine…
  "test-url-urltooptions.js",
  // AssertionError: Missing expected exception (TypeError).
  "test-util-deprecate-invalid-code.js",
  // TypeError: undefined is not an object
  "test-util-deprecate.js",
  // TypeError: getCallSites is not a function. (In 'getCallSites(1)', 'getCallSites' is undefined)
  "test-util-getcallsites-preparestacktrace.js",
  // TypeError: undefined is not an object
  "test-util-inherits.js",
  "test-util-inspect-getters-accessing-this.js",
  // error: ownKeys
  "test-util-inspect-proxy.js",
  // TypeError: undefined is not an object (evaluating 'inspect.defaultOptions.compact = 5')
  "test-util-inspect-regexp.js",
  // error: fhqwhgads
  "test-util-primordial-monkeypatching.js",
  // TypeError: (void 0) is not a function. (In '(void 0)(before)', '(void 0)' is undefined)
  "test-util-stripvtcontrolcharacters.js",
  // TypeError: undefined is not an object
  "test-util-styletext.js",
  // TypeError: createBrotliDecompress is not a function. (In 'createBrotliDecompress()', 'createBrotliDecompress'…
  "test-zlib-brotli-16GB.js",
  // TypeError: (void 0) is not a function. (In '(void 0)(input, { dictionary }, common.mustSucceed((compressed) =…
  "test-zlib-brotli-dictionary.js",
  // TypeError: Cannot destructure property 'BROTLI_OPERATION_PROCESS' from null or undefined value
  "test-zlib-brotli-flush-invalid-kind.js",
  // TypeError: undefined is not a constructor (evaluating 'new (void 0)')
  "test-zlib-brotli-flush.js",
  // TypeError: (void 0) is not a function. (In '(void 0)(inputString, common.mustCall((err, buffer) => { assert(i…
  "test-zlib-brotli-from-string.js",
  // TypeError: Attempted to assign to readonly property.
  "test-zlib-brotli-kmaxlength-rangeerror.js",
  // TypeError: undefined is not an object (evaluating '(void 0).BROTLI_MIN_QUALITY')
  "test-zlib-brotli.js",
  // TypeError: (void 0) is not a function. (In '(void 0)(15)', '(void 0)' is undefined)
  "test-zlib-close-after-error.js",
  // TypeError: (void 0) is not a function. (In '(void 0)("hello", common.mustCall((err, out) => { const unzip = (…
  "test-zlib-close-after-write.js",
  // TypeError: (void 0) is not a function. (In '(void 0)()', '(void 0)' is undefined)
  "test-zlib-close-in-ondata.js",
  // TypeError: undefined is not an object (evaluating 'zlib.constants.Z_OK')
  "test-zlib-const.js",
  // TypeError: zlib[method[0]] is not a function. (In 'zlib[method[0]](expect, opts, common.mustCall((err, result…
  "test-zlib-convenience-methods.js",
  // TypeError: (void 0) is not a function. (In '(void 0)(buf, crc)', '(void 0)' is undefined)
  "test-zlib-crc32.js",
  // TypeError: (void 0) is not a function. (In '(void 0)()', '(void 0)' is undefined)
  "test-zlib-create-raw.js",
  "test-zlib-deflate-constructors.js",
  // TypeError: undefined is not an object (evaluating 'DeflateRaw.prototype')
  "test-zlib-deflate-raw-inherits.js",
  // TypeError: (void 0) is not a function. (In '(void 0)()', '(void 0)' is undefined)
  "test-zlib-destroy-pipe.js",
  "test-zlib-destroy.js",
  "test-zlib-dictionary-fail.js",
  // TypeError: (void 0) is not a function. (In '(void 0)({ dictionary: spdyDict })', '(void 0)' is undefined)
  "test-zlib-dictionary.js",
  // TypeError: The "original" argument must be of type Function
  "test-zlib-empty-buffer.js",
  // TypeError: undefined is not an object
  "test-zlib-failed-init.js",
  // TypeError: (void 0) is not a function. (In '(void 0)({ highWaterMark: 16384 })', '(void 0)' is undefined)
  "test-zlib-flush-drain-longblock.js",
  // TypeError: (void 0) is not a function. (In '(void 0)({
  "test-zlib-flush-drain.js",
  // TypeError: undefined is not an object (evaluating '(void 0).Z_SYNC_FLUSH')
  "test-zlib-flush-flags.js",
  // TypeError: createGzip is not a function. (In 'createGzip()', 'createGzip' is undefined)
  "test-zlib-flush-write-sync-interleaved.js",
  // TypeError: (void 0) is not a function. (In '(void 0)({ level: 0 })', '(void 0)' is undefined)
  "test-zlib-flush.js",
  // TypeError: (void 0) is not a function. (In '(void 0)("abc")', '(void 0)' is undefined)
  "test-zlib-from-gzip-with-trailing-garbage.js",
  // TypeError: (void 0) is not a function. (In '(void 0)(inputString, common.mustCall((err, buffer) => { (void 0)…
  "test-zlib-from-string.js",
  // TypeError: undefined is not an object (evaluating 'constants.BROTLI_PARAM_MODE')
  "test-zlib-invalid-arg-value-brotli-compress.js",
  // TypeError: (void 0) is not a function. (In '(void 0)()', '(void 0)' is undefined)
  "test-zlib-invalid-input.js",
  // TypeError: Attempted to assign to readonly property.
  "test-zlib-kmaxlength-rangeerror.js",
  // TypeError: (void 0) is not a function. (In '(void 0)(encoded, { maxOutputLength: 64 }, common.expectsError({
  "test-zlib-maxOutputLength.js",
  // TypeError: gzipSync is not a function. (In 'gzipSync("fooobar")', 'gzipSync' is undefined)
  "test-zlib-no-stream.js",
  // TypeError: undefined is not an object
  "test-zlib-not-string-or-buffer.js",
  // TypeError: undefined is not a constructor (evaluating 'new Gunzip({ objectMode: !0 })')
  "test-zlib-object-write.js",
  // TypeError: undefined is not an object (evaluating '(void 0).Z_DEFAULT_STRATEGY')
  "test-zlib-params.js",
  // TypeError: compress is not a function. (In 'compress(input)', 'compress' is undefined)
  "test-zlib-premature-end.js",
  // TypeError: createHash2 is not a function. (In 'createHash2("sha1")', 'createHash2' is undefined)
  "test-zlib-random-byte-pipes.js",
  // TypeError: (void 0) is not a function. (In '(void 0)()', '(void 0)' is undefined)
  "test-zlib-reset-before-write.js",
  // TypeError: factory is not a function. (In 'factory()', 'factory' is undefined)
  "test-zlib-reset-during-write.js",
  // TypeError: undefined is not a constructor (evaluating 'new (void 0)')
  "test-zlib-sync-no-event.js",
  // TypeError: zlib[methods.comp] is not a function. (In 'zlib[methods.comp](inputString, function(err, compresse…
  "test-zlib-truncated.js",
  // TypeError: (void 0) is not a function. (In '(void 0)("abc")', '(void 0)' is undefined)
  "test-zlib-unzip-one-byte-chunks.js",
  // TypeError: (void 0) is not a function. (In '(void 0)("hello", common.mustCall(function(err, out) { const unzi…
  "test-zlib-write-after-close.js",
  // TypeError: (void 0) is not a function. (In '(void 0)("Welcome")', '(void 0)' is undefined)
  "test-zlib-write-after-end.js",
  // TypeError: createCompress is not a function. (In 'createCompress()', 'createCompress' is undefined)
  "test-zlib-write-after-flush.js",
  // TypeError: undefined is not a constructor (evaluating 'new Compressor')
  "test-zlib-zero-byte.js",
  // TypeError: (void 0) is not a function. (In '(void 0)({ windowBits: 0 })', '(void 0)' is undefined)
  "test-zlib-zero-windowBits.js",
  // TypeError: (void 0) is not a function. (In '(void 0)(input, { dictionary }, common.mustSucceed((compressed) =…
  "test-zlib-zstd-dictionary.js",
  // TypeError: undefined is not a constructor (evaluating 'new (void 0)')
  "test-zlib-zstd-flush.js",
  // TypeError: (void 0) is not a function. (In '(void 0)(inputString, common.mustCall((err, buffer) => { assert(i…
  "test-zlib-zstd-from-string.js",
  // TypeError: Attempted to assign to readonly property.
  "test-zlib-zstd-kmaxlength-rangeerror.js",
  // TypeError: undefined is not an object TypeError: undefined is not an object TypeError: undefined is not an ob…
  "test-zlib-zstd-pledged-src-size.js",
  // TypeError: undefined is not an object (evaluating '(void 0).ZSTD_c_compressionLevel')
  "test-zlib-zstd.js",
];

// Left out:
// test-buffer-constructor-deprecation-error.js: skips itself
// test-buffer-pending-deprecation.js: skips itself
// test-buffer-tostring-rangeerror.js: takes more than a minute
// test-events-uncaught-exception-stack.js: returns at once on Windows
// test-string-decoder-fuzz.js: its input is random
// test-util-inspect-long-running.js: takes more than a minute
