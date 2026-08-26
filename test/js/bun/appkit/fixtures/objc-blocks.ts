// objc.block and bare functions as block arguments: Foundation calling back
// into JavaScript synchronously (enumeration, predicates, comparators) and
// from the main run loop (operation queue, timers, completion handlers).
import { app } from "bun:appkit";
import { objc } from "bun:objc";
import { emit, run, waitFor } from "./_util";

type Thrown = { threw: false; value?: unknown } | { threw: true; isTypeError: boolean; code?: string; message: string };

function tryCall(f: () => unknown): Thrown {
  try {
    const value = f();
    return { threw: false, value: typeof value === "object" && value !== null ? String(value) : value };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err?.code === "ERR_OBJC_UNAVAILABLE") throw err;
    return { threw: true, isTypeError: err instanceof TypeError, code: err?.code, message: String(err?.message) };
  }
}

function attempt(name: string, f: () => unknown) {
  emit({ step: name, ...tryCall(f) });
}

const uncaught: string[] = [];
process.on("uncaughtException", e => {
  uncaught.push(String((e as Error)?.message ?? e));
});

await run(async () => {
  const {
    NSObject,
    NSMutableArray,
    NSIndexSet,
    NSPredicate,
    NSExpression,
    NSOperation,
    NSOperationQueue,
    NSRunLoop,
    NSTimer,
    NSAnimationContext,
    NSString,
    NSThread,
    NSArray,
    NSInvocationOperation,
    NSNotificationCenter,
  } = objc.classes;
  const list = objc.ns(["alpha", "beta", "gamma", "delta"]) as any;

  // -[NSArray enumerateObjectsUsingBlock:]: void (^)(id, NSUInteger, BOOL *stop).
  {
    const seen: unknown[] = [];
    let receiver: unknown = "unset";
    list.enumerateObjectsUsingBlock_(function (this: unknown, obj: any, idx: number, stop: { value: boolean }) {
      receiver = this;
      seen.push([objc.js(obj), idx, stop.value, list.count()]);
      if (idx === 2) stop.value = true;
    });
    emit({ step: "enumerate", seen, receiverUndefined: receiver === undefined });
  }

  // BOOL-returning blocks: indexesOfObjectsPassingTest:, indexOfObjectPassingTest:, predicateWithBlock:.
  {
    const indexes = list.indexesOfObjectsPassingTest_((_obj: unknown, idx: number) => idx % 2 === 1);
    const first = list.indexOfObjectPassingTest_((obj: any) => objc.js(obj) === "gamma");
    const none = list.indexOfObjectPassingTest_(() => false);
    const predicate = NSPredicate.predicateWithBlock_((obj: any, _bindings: unknown) => objc.js(obj) === "yes");
    emit({
      step: "passing test",
      isIndexSet: indexes.isKindOfClass_(NSIndexSet),
      count: indexes.count(),
      hasOne: indexes.containsIndex_(1),
      hasThree: indexes.containsIndex_(3),
      hasTwo: indexes.containsIndex_(2),
      first,
      none: none === objc.NSNotFound,
      yes: predicate.evaluateWithObject_("yes"),
      no: predicate.evaluateWithObject_("no"),
    });
  }

  // NSComparator (NSComparisonResult (^)(id, id)) and a dictionary enumeration.
  {
    const sorted = list.sortedArrayUsingComparator_((a: any, b: any) => {
      const [x, y] = [objc.js(a) as string, objc.js(b) as string];
      return x < y ? 1 : x > y ? -1 : 0;
    });
    const pairs: unknown[] = [];
    (objc.ns({ one: 1, two: 2 }) as any).enumerateKeysAndObjectsUsingBlock_((k: any, v: any, _stop: unknown) =>
      pairs.push([objc.js(k), objc.js(v)]),
    );
    pairs.sort();
    emit({ step: "comparator", sorted: objc.js(sorted), pairs });
  }

  // objc.block(fn, types): an explicit block, reusable, passed where any block goes.
  {
    const seen: number[] = [];
    const block = objc.block((_obj: unknown, idx: number, _stop: unknown) => seen.push(idx), "v@?@Q^B") as any;
    list.enumerateObjectsUsingBlock_(block);
    list.enumerateObjectsWithOptions_usingBlock_(2, block); // NSEnumerationReverse
    // An object-returning block, called by NSExpression (not in the known list, so types are required).
    const expression = NSExpression.expressionForBlock_arguments_(
      objc.block((obj: any, _exprs: unknown, _context: unknown) => `value:${objc.js(obj)}`, "@@?@@@"),
      [],
    );
    const defaultTypes = objc.block((_a: unknown) => {}) as any;
    emit({
      step: "explicit",
      seen,
      description: /Block/.test(String(block)),
      expression: objc.js(expression.expressionValueWithObject_context_("x", null)),
      expressionNull: objc.js(expression.expressionValueWithObject_context_(null, null)),
      defaultTypes: /Block/.test(String(defaultTypes)),
      same: objc.same(block, block),
    });
  }

  // Calling a block from JavaScript: its own signature types the call. One a
  // framework hands back (NSExpression's) calls the same way; `invoke` on
  // anything that is not a block is the selector of that name.
  {
    const compare = objc.block((a: unknown, b: unknown) => (String(a) < String(b) ? -1 : 1), "q@?@@") as any;
    const stop = objc.out(false);
    const each = objc.block((_o: unknown, i: number, s: { value: boolean }) => (s.value = i === 1), "v@?@Q^B") as any;
    const expression = NSExpression.expressionForBlock_arguments_(
      objc.block((obj: any) => `got:${objc.js(obj)}`, "@@?@@@"),
      [],
    );
    const fromFramework = expression.expressionBlock();
    const { NSInvocation } = objc.classes;
    const inv = NSInvocation.invocationWithMethodSignature_(list.methodSignatureForSelector_("count"));
    inv.setSelector_("count");
    inv.setTarget_(list);
    emit({
      step: "invoke",
      compare: [compare.invoke("a", "b"), compare.invoke("b", "a")],
      stopBefore: stop.value,
      stopAfter: (each.invoke("x", 1, stop), stop.value),
      omitted: tryCall(() => each.invoke("x", 0)),
      fromFramework: objc.js(fromFramework.invoke("z", [], null)),
      selector: (inv.invoke(), typeof inv.invoke),
      tooMany: tryCall(() => compare.invoke(1, 2, 3)),
      notBlockClass: typeof (list as any).invoke,
    });
  }

  // Blocks Foundation runs later, from the main run loop, need the app
  // started: nothing else runs that run loop, however long Bun's own event
  // loop turns. `objc.app.start()` (or a Window, keepAlive, activate())
  // starts it; a retain() token holds the process open without a window.
  {
    let operation = 0;
    let performed = 0;
    const timers: string[] = [];
    NSOperationQueue.mainQueue().addOperationWithBlock_(() => operation++);
    NSRunLoop.mainRunLoop().performBlock_(() => performed++);
    const timer = NSTimer.scheduledTimerWithTimeInterval_repeats_block_(0.001, false, (t: any) =>
      timers.push(String(t.className())),
    );
    const before = { operation, performed, timers: timers.length };
    // Bun's loop turns (timers, I/O) but the main run loop does not run.
    for (let turn = 0; turn < 5; turn++) await new Promise<void>(resolve => setTimeout(resolve, 2));
    const notStarted = { running: objc.app.isRunning, operation, performed, timers: timers.length };
    objc.app.start("accessory");
    const hold = objc.app.retain();
    await waitFor(() => operation === 1 && performed === 1 && timers.length === 1, "main run loop blocks");
    emit({ step: "run loop", before, notStarted, operation, performed, timers, timerValid: timer.isValid() });
    app.keepAlive = true;
    hold.release();
  }

  // +[NSAnimationContext runAnimationGroup:completionHandler:]: the group runs
  // now with the context, the completion handler after; a null block is nil.
  {
    const contexts: string[] = [];
    let completed = 0;
    NSAnimationContext.runAnimationGroup_completionHandler_(
      (context: any) => {
        context.setDuration_(0);
        contexts.push(String(context.className()));
      },
      () => completed++,
    );
    NSAnimationContext.runAnimationGroup_completionHandler_(
      (context: any) => contexts.push(String(context.className())),
      null,
    );
    const syncContexts = contexts.slice();
    const syncCompleted = completed;
    await waitFor(() => completed === 1, "animation completion handler");
    emit({ step: "animation", syncContexts, syncCompleted, completed });
  }

  // A throw stops the enumeration (the caller reads zero and *stop is set)
  // and comes back out of the send that ran the block; a result that does
  // not fit the return type likewise. Nothing is reported as uncaught.
  {
    let calls = 0;
    const thrown = tryCall(() =>
      list.enumerateObjectsUsingBlock_(() => {
        calls++;
        throw new Error("thrown in block");
      }),
    );
    let tests = 0;
    const misfit = tryCall(() =>
      list.indexesOfObjectsPassingTest_(() => {
        tests++;
        return "not a boolean";
      }),
    );
    // The first throw is the one that comes out, however many times the comparator ran on.
    let compared = 0;
    const sorted = tryCall(() =>
      NSMutableArray.arrayWithArray_([3, 1, 2]).sortedArrayUsingComparator_(() => {
        throw new Error(`compare ${++compared}`);
      }),
    );
    // A block that itself sends with a throwing comparator sees THAT send
    // throw, inside the block; the outer send returns normally once the
    // block has dealt with it.
    let inner: unknown = null;
    let outerCalls = 0;
    const outer = tryCall(() =>
      list.enumerateObjectsUsingBlock_((_obj: unknown, _idx: unknown, stop: { value: boolean }) => {
        outerCalls++;
        inner = tryCall(() =>
          NSMutableArray.arrayWithArray_([3, 1, 2]).sortedArrayUsingComparator_(() => {
            throw new Error("nested compare");
          }),
        );
        stop.value = true;
      }),
    );
    emit({
      step: "throws",
      calls,
      thrown,
      tests,
      misfit,
      sorted,
      comparedMore: compared > 1,
      inner,
      outerCalls,
      outer,
      uncaught: uncaught.slice(),
    });
  }

  // A function that lets go of the only reference to its own block while it runs.
  {
    let calls = 0;
    const block: any = objc.block((_obj: unknown, _idx: unknown, stop: { value: boolean }) => {
      calls++;
      block.release();
      stop.value = true;
    }, "v@?@Q^B");
    list.enumerateObjectsUsingBlock_(block);
    emit({ step: "release inside", calls, released: tryCall(() => list.enumerateObjectsUsingBlock_(block)) });
  }

  // A void block invoked on another thread is handed over: the queue's call
  // returns at once and the function runs on the main thread's next turn,
  // its object argument kept alive for the trip. One that returns a value
  // cannot be, and the main thread hears about it instead.
  {
    let ran = 0;
    let ranOnMain: boolean | null = null;
    let received: string | null = null;
    const before = uncaught.length;
    const queue = NSOperationQueue.new();
    queue.addOperationWithBlock_(() => {
      ran++;
      ranOnMain = NSThread.isMainThread();
    });
    queue.waitUntilAllOperationsAreFinished();
    const ranBeforeTurn = ran;
    // A notification observed on the queue: its block takes the
    // notification, made on the main thread but delivered on the queue's,
    // and retained for the trip back.
    const center = NSNotificationCenter.defaultCenter();
    const observer = center.addObserverForName_object_queue_usingBlock_("FixtureHandOver", null, queue, (note: any) => {
      received = `${note.object()} on ${NSThread.isMainThread() ? "main" : "other"}`;
    });
    center.postNotificationName_object_("FixtureHandOver", "payload");
    await waitFor(() => ran === 1 && received !== null, "the handed-over calls to run");
    center.removeObserver_(observer);
    // An array sorted on the queue with a comparator, which returns a value: refused.
    const items = NSArray.arrayWithArray_(["only", "two"]);
    const sort = NSInvocationOperation.alloc().initWithTarget_selector_object_(
      items,
      "sortedArrayUsingComparator:",
      objc.block(() => 0, "q@?@@"),
    );
    queue.addOperation_(sort);
    queue.waitUntilAllOperationsAreFinished();
    await waitFor(() => uncaught.length > before, "the off-thread comparator to be reported");
    emit({
      step: "off thread",
      ranBeforeTurn,
      ran,
      ranOnMain,
      received,
      uncaught: [...new Set(uncaught.slice(before))],
    });
    // What the hand-over means for native synchronisation. An operation's
    // completion block is handed over too, so waiting for the operation
    // finds it finished with neither block run yet. A wait on this thread
    // for something the handed-over function must do cannot end until the
    // turn the function needs: a timed NSCondition wait runs out.
    {
      const { NSBlockOperation, NSCondition, NSDate } = objc.classes;
      let body = 0;
      let completion = 0;
      const op = NSBlockOperation.blockOperationWithBlock_(() => void body++);
      op.setCompletionBlock_(() => void completion++);
      queue.addOperation_(op);
      op.waitUntilFinished();
      const afterWait = { finished: op.isFinished(), body, completion };
      await waitFor(() => body === 1 && completion === 1, "the operation's blocks to be handed over");
      const condition = NSCondition.new();
      let signalled = false;
      queue.addOperationWithBlock_(() => {
        condition.lock();
        signalled = true;
        condition.signal();
        condition.unlock();
      });
      condition.lock();
      const started = performance.now();
      // The wait may end early of its own accord (pthread semantics), so
      // only whether the signal arrived during it is reported.
      condition.waitUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.25));
      condition.unlock();
      const waited = performance.now() - started;
      const signalledDuringWait = signalled;
      await waitFor(() => signalled, "the signalling block to be handed over");
      // Many hand-overs from one thread queue up and arrive in the order
      // they were made.
      const order: number[] = [];
      const numbered = center.addObserverForName_object_queue_usingBlock_(
        "FixtureNumbered",
        null,
        queue,
        (note: any) => {
          order.push(Number(objc.js(note.object())));
        },
      );
      const total = 1000;
      for (let i = 0; i < total; i++) center.postNotificationName_object_("FixtureNumbered", i);
      queue.waitUntilAllOperationsAreFinished();
      const arrivedBeforeTurn = order.length;
      await waitFor(() => order.length === total, "the numbered hand-overs to arrive", 10_000);
      center.removeObserver_(numbered);
      emit({
        step: "hand-over waits",
        afterWait,
        afterTurn: { body, completion },
        timedWait: { waitedMs: Math.round(waited), signalledDuringWait },
        ordered: { arrivedBeforeTurn, total: order.length, inOrder: order.every((n, i) => n === i) },
      });
    }
  }

  // Any signature: the invoke function is a closure made for it.
  {
    const six = objc.block((...args: unknown[]) => args.length, "q@?@@@@@@") as any;
    const mixed = objc.block(
      (flag: boolean, small: number, ratio: number, sel: string, cls: unknown, rect: { size: { width: number } }) =>
        `${flag} ${small} ${ratio} ${sel} ${cls} ${rect.size.width}`,
      "@@?Bsf:#{CGRect={CGPoint=dd}{CGSize=dd}}",
    ) as any;
    const point = objc.block((dx: number) => ({ x: dx, y: -dx }), "{CGPoint=dd}@?d") as any;
    const ranges: [unknown, unknown][] = [];
    NSString.stringWithString_("ab cd").enumerateSubstringsInRange_options_usingBlock_(
      { location: 0, length: 5 },
      objc.enums.NSStringEnumerationByWords,
      (word: unknown, range: { location: number }, _enclosing: unknown, _stop: unknown) =>
        ranges.push([String(word), range.location]),
    );
    emit({
      step: "any signature",
      six: six.invoke(1, 2, 3, 4, 5, 6),
      mixed: String(mixed.invoke(true, -3, 0.5, "count", NSString, { x: 0, y: 0, width: 9, height: 1 })),
      point: point.invoke(2.5),
      ranges,
    });
  }

  // What is refused.
  attempt("unsupported types", () => objc.block(() => {}, "^v@?@"));
  attempt("unsupported argument", () => objc.block(() => {}, "v@?{x=[4i]}"));
  attempt("no block marker", () => objc.block(() => {}, "v@:"));
  attempt("invalid types", () => objc.block(() => {}, "{{"));
  attempt("not a function", () => (objc as any).block("nope"));
  attempt("types not a string", () => (objc as any).block(() => {}, 3));
  // A framework outside the ones the table covers.
  attempt("unknown selector", () => {
    objc.classes.NSBundle.bundleWithPath_("/System/Library/Frameworks/AVFoundation.framework").load();
    const asset = objc.classes.AVURLAsset.URLAssetWithURL_options_(
      objc.classes.NSURL.fileURLWithPath_("/nonexistent"),
      null,
    );
    return asset.loadValuesAsynchronouslyForKeys_completionHandler_([], () => {});
  });
  attempt("not a block object", () => list.enumerateObjectsUsingBlock_(NSObject.new()));
  attempt("wrong block type", () =>
    list.enumerateObjectsUsingBlock_(objc.block((_a: unknown, _b: unknown) => 0, "q@?@@")),
  );
  attempt("completion block", () => NSOperation.new().setCompletionBlock_(() => {}));
  attempt("message to block", () => (objc.block(() => {}) as any).className());
  attempt("invoke non-block", () => (NSObject.new() as any).invoke());
  attempt("null block", () => list.sortedArrayUsingComparator_(null));

  // Lifetime: the block keeps its function while anything retains the block.
  {
    let collected = 0;
    const registry = new FinalizationRegistry(() => collected++);
    const holder = NSMutableArray.new();
    (() => {
      const released = () => {};
      registry.register(released, "released");
      (objc.block(released) as any).release();
      const held = () => {};
      registry.register(held, "held");
      const block = objc.block(held) as any;
      holder.addObject_(block); // Foundation retains (Block_copy) it
      block.release();
      // Released for the last time by a background queue, once its operation has run.
      const elsewhere = () => {};
      registry.register(elsewhere, "elsewhere");
      const queue = NSOperationQueue.new();
      queue.addOperationWithBlock_(elsewhere);
      queue.waitUntilAllOperationsAreFinished();
    })();
    await waitFor(
      () => {
        Bun.gc(true);
        return collected >= 2;
      },
      "the released blocks' functions to be collected",
      30_000,
    );
    // Give the collector a few more turns to show the held one stays.
    for (let i = 0; i < 5; i++) {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
    }
    const whileHeld = collected;
    holder.removeAllObjects();
    await waitFor(
      () => {
        Bun.gc(true);
        return collected >= 3;
      },
      "the held block's function to be collected after Foundation released it",
      30_000,
    );
    emit({ step: "lifetime", whileHeld, afterRemoval: collected });
  }

  // The same with no handle at all: a function handed straight to a
  // scheduled NSTimer stays while the timer is live, and goes once it is
  // invalidated.
  {
    const { NSTimer } = objc.classes;
    let fired = 0;
    let collected = false;
    const registry = new FinalizationRegistry(() => {
      collected = true;
    });
    const timer = (() => {
      const fn = () => fired++;
      registry.register(fn, "fn");
      return NSTimer.scheduledTimerWithTimeInterval_repeats_block_(60, true, fn);
    })();
    for (let i = 0; i < 5; i++) {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
    }
    timer.fire();
    const whileScheduled = { collected, fired };
    timer.invalidate();
    await waitFor(
      () => {
        Bun.gc(true);
        return collected;
      },
      "the invalidated timer's block function to be collected",
      30_000,
    );
    emit({ step: "lifetime timer", whileScheduled, collectedAfterInvalidate: collected });
  }

  app.keepAlive = false;
  emit({ step: "done" });
});
