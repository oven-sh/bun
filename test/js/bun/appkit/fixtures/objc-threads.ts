// The bridge on more than one thread: a Worker doing Foundation work, the
// classes it is refused, both threads sending at once with their own handle
// tables, a class name both define, and a Worker terminated mid-send whose
// blocks and class are called afterwards.
import { objc } from "bun:objc";
import { emit, run, waitFor } from "./_util";

await run(async () => {
  const { NSMutableArray, NSString, NSProcessInfo, NSThread, NSNotificationCenter } = objc.classes;
  // Read before anything else here starts a thread.
  const multiThreaded = NSThread.isMultiThreaded();

  const worker = new Worker(new URL("./_objc-threads-worker.ts", import.meta.url).href);
  const inbox: any[] = [];
  let wake: (() => void) | undefined;
  worker.onmessage = e => {
    inbox.push(e.data);
    wake?.();
  };
  worker.onerror = e => {
    throw e.error ?? e;
  };
  const next = async () => {
    while (inbox.length === 0) await new Promise<void>(resolve => (wake = resolve));
    return inbox.shift();
  };

  const { ready } = await next();
  // The Worker has defined a class of this name by now; the plain name is
  // still the main thread's.
  const Shared = objc.defineClass({
    name: "FixtureSharedName",
    methods: { "tag": { types: "q@:", fn: () => 1 } },
  }) as any;
  const target = objc.target(() => {}) as any;
  emit({
    step: "worker foundation",
    ...ready,
    multiThreaded,
    mainClass: String(Shared),
    mainTag: Shared.new().tag(),
    sameTargetClass: String(target.className()) === ready.target.className,
  });

  // Both threads send a few hundred messages at about the same time: the
  // Worker says when it has begun, and this thread starts then.
  const count = 300;
  worker.postMessage({ go: "burst", count });
  await next();
  const list = NSMutableArray.array();
  for (let i = 0; i < count; i++) list.addObject_(NSString.stringWithString_(`main ${i}`));
  let own = 0;
  for (let i = 0; i < count; i++) if (objc.js(list.objectAtIndex_(i)) === `main ${i}`) own++;
  const info = NSProcessInfo.processInfo();
  const fromWorker = await next();
  emit({
    step: "concurrent",
    main: { count: list.count(), own },
    worker: fromWorker.burst,
    processInfo: {
      mainSame: info === NSProcessInfo.processInfo(),
      workerSame: fromWorker.processInfo.same,
      sameObject: String(info[objc.pointer]) === fromWorker.processInfo.address,
    },
    subclass: fromWorker.subclass,
  });
  worker.terminate();

  // A Worker terminated while it is sending, holding handles, blocks and a
  // defined class: the process carries on.
  const busy = new Worker(new URL("./_objc-threads-busy.ts", import.meta.url).href);
  const { counterClass } = await new Promise<any>((resolve, reject) => {
    busy.onmessage = e => resolve(e.data);
    busy.onerror = e => reject(e.error ?? e);
  });
  const closed = new Promise<void>(resolve => busy.addEventListener("close", () => resolve()));
  // A burst of notifications for the Worker's queue-based observer, each
  // with a payload object nothing but a weak table holds afterwards; the
  // terminate lands while they are still being handed over.
  const { NSHashTable, NSObject } = objc.classes;
  const payloads = NSHashTable.weakObjectsHashTable();
  const posted = 3000;
  for (let i = 0; i < posted; i++) {
    const payload = NSObject.new();
    payloads.addObject_(payload);
    NSNotificationCenter.defaultCenter().postNotificationName_object_("FixtureBusyPayload", payload);
    payload.release();
    if (i === posted / 2) busy.terminate();
  }
  await closed;
  // The Worker's blocks and class are still registered; their functions have
  // no thread to run on any more, so they do nothing and answer zero, and
  // stderr says so once. The first block is called on a dispatch queue's
  // thread (posting waits for it), the second on this one.
  const center = NSNotificationCenter.defaultCenter();
  center.postNotificationName_object_("FixtureDeadQueue", null);
  center.postNotificationName_object_("FixtureDeadMain", null);
  const orphan = objc.classes[counterClass].new();
  emit({
    step: "terminated",
    after: objc.js(NSString.stringWithString_("still here")),
    mainTag: Shared.new().tag(),
    orphan: [orphan.count(), orphan.count()],
  });
  // The hops the busy Worker never got to run (a queue's observer block,
  // each call carrying a notification with its own payload object) were let
  // go with their retained arguments when the Worker closed.
  await waitFor(
    () => {
      Bun.gc(true);
      return payloads.anyObject() === null;
    },
    "the payloads of the dropped hand-overs to deallocate",
    30_000,
  );
  emit({ step: "dropped hops", posted, payloadsFreed: true });

  // A completion handler called on another thread reaches this script only
  // while something holds it open: the script's own statements are over
  // before the session's thread gets to the block, so a retain token held
  // until the completion has run is what keeps the process here for it.
  const { NSURLSession, NSURL } = objc.classes;
  const hold = objc.app.retain();
  NSURLSession.sharedSession()
    .dataTaskWithURL_completionHandler_(
      NSURL.fileURLWithPath_(import.meta.path),
      (data: any, _response: unknown, error: unknown) => {
        emit({
          step: "hand-over held",
          onMain: NSThread.isMainThread(),
          hasData: data !== null && data.length() > 0,
          noError: error === null,
        });
        hold.release();
      },
    )
    .resume();
});
