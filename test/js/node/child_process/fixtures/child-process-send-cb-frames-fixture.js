const { heapStats } = require("bun:jsc");
const { AsyncLocalStorage } = require("async_hooks");
const { fork } = require("child_process");

const asyncLocalStorage = new AsyncLocalStorage();
// An AsyncContextFrame is what native code keeps a callback in when the callback has to run later
// in the async context it was passed in. heapStats() does not collect, so the difference between
// two calls counts every frame created in between.
const frames = () => heapStats().objectTypeCounts.AsyncContextFrame ?? 0;
// More than the channel's buffer holds: send() returns before the write is complete, unless the
// peer reads the rest in the meantime.
const big = Buffer.alloc(1 << 20, "x").toString();

// Ten sends the channel takes at once, then one that waits for the channel, each in its own store.
function measure(target, report) {
  const result = { stores: [] };
  const callback = () => result.stores.push(asyncLocalStorage.getStore());
  const before = frames();
  for (let i = 0; i < 10; i++) asyncLocalStorage.run(i, () => target.send({ i }, callback));
  result.framesCreated = frames() - before;
  // A callback queued inside send() runs before a tick queued after it.
  process.nextTick(() => (result.ranBeforeNextTick = result.stores.length));
  asyncLocalStorage.run("big", () => target.send({ big }, () => (callback(), report(result))));
}

if (process.argv[2] === "child") {
  process.on("message", message => {
    if (message.start) measure(process, child => process.send({ child }, () => process.disconnect()));
  });
} else {
  const child = fork(__filename, ["child"]);
  measure(child, parent => {
    child.on("message", message => message.child && console.log(JSON.stringify({ parent, child: message.child })));
    child.send({ start: true });
  });
}
