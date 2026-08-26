// Holds handles, a block a background queue keeps calling, a defined class,
// an attached target and two notification observers, and keeps sending
// until the main thread terminates this Worker part way through.
import { objc } from "bun:objc";

const { NSMutableArray, NSString, NSOperationQueue, NSNotificationCenter, NSDate } = objc.classes;

const held = NSMutableArray.array();
const Counter = objc.defineClass({
  name: "FixtureBusyCounter",
  methods: { "count": { types: "q@:", fn: () => held.count() } },
}) as any;
const counter = Counter.new();
const target = objc.target(() => {});
held.addObject_(counter);
held.addObject_(target);

// Blocks of this Worker's for the main thread to have called once the Worker
// is gone: the first is delivered on a dispatch queue's thread, the second on
// the posting thread. The notification center keeps both.
const center = NSNotificationCenter.defaultCenter();
center.addObserverForName_object_queue_usingBlock_("FixtureDeadQueue", null, NSOperationQueue.new(), () => {});
center.addObserverForName_object_queue_usingBlock_("FixtureDeadMain", null, null, () => {});
// A third, for the main thread's burst: each call carries the notification
// and with it the payload object, retained for the trip.
center.addObserverForName_object_queue_usingBlock_("FixtureBusyPayload", null, NSOperationQueue.new(), (note: any) => {
  void note;
});

// A background queue calling a block of ours over and over while the loop
// below runs: each call is handed over from the queue's thread and made
// here whenever the loop yields, until this thread is gone.
const queue = NSOperationQueue.new();
const block = objc.block(() => {}, "v@?");
for (let i = 0; i < 1000; i++) queue.addOperationWithBlock_(block);

for (let i = 0; ; i++) {
  held.addObject_(NSString.stringWithString_("x".repeat(64)));
  held.addObject_(NSDate.date());
  counter.count();
  if (held.count() > 5000) held.removeAllObjects();
  if (i % 256 === 255) await new Promise<void>(resolve => setImmediate(resolve));
  // Well into the loop, so the terminate lands mid-send.
  if (i === 1000) postMessage({ counterClass: String(Counter) });
}
