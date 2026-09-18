// Rejects promises with no handler, then takes them out of the queue of pending rejections in
// every way there is (oldest first, newest first, from the middle, by being reported), and
// checks the 'unhandledRejection' and 'rejectionHandled' events against a model of that queue.
// The sizes cross the thresholds of RejectedPromiseQueue (ZigGlobalObject.cpp): more than 64
// entries before one leaves from the middle, and more than 1,024 that left while others stay.
const noop = () => {};
const promises = new Map(); // id -> promise, for every promise that can still get a handler
const ids = new Map(); // promise -> id
let queued = []; // ids rejected and not handled yet, in rejection order
const reported = []; // ids that had their 'unhandledRejection' and have no handler yet
let nextId = 0;

let unhandled = [];
let handledLate = [];
process.on("unhandledRejection", reason => unhandled.push(reason));
process.on("rejectionHandled", promise => handledLate.push(ids.get(promise)));

function reject(count) {
  for (let i = 0; i < count; i++) {
    const id = nextId++;
    const promise = Promise.reject(id);
    promises.set(id, promise);
    ids.set(promise, id);
    queued.push(id);
  }
}

function handle(id) {
  promises.get(id).catch(noop);
  promises.delete(id);
}

// Handle the queued promise at `position` (negative: from the newest) before it is reported.
function handleQueued(position) {
  handle(queued.splice(position, 1)[0]);
}

let expectedHandledLate = [];
function handleReported(position) {
  const id = reported.splice(position, 1)[0];
  expectedHandledLate.push(id);
  handle(id);
}

function assertSame(what, actual, expected) {
  if (actual.length !== expected.length) throw new Error(`${what}: got ${actual.length}, expected ${expected.length}`);
  for (let i = 0; i < expected.length; i++)
    if (actual[i] !== expected[i]) throw new Error(`${what}: at ${i} got ${actual[i]}, expected ${expected[i]}`);
}

// Everything still queued is reported now, oldest first.
async function turn(label) {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assertSame(`${label}: unhandledRejection`, unhandled, queued);
  assertSame(`${label}: rejectionHandled`, handledLate, expectedHandledLate);
  reported.push(...queued);
  queued = [];
  unhandled = [];
  handledLate = [];
  expectedHandledLate = [];
}

// The newest first, the oldest first, and the only one.
reject(8);
handleQueued(-1);
handleQueued(0);
handleQueued(-1);
handleQueued(0);
reject(1);
handleQueued(0);
await turn("ends");
handleReported(0);
handleReported(-1);
await turn("reported");

// From the middle of a few, then of many. More are rejected and handled in between.
reject(12);
for (const position of [5, 5, 1, -2, 3]) handleQueued(position);
reject(40);
for (let i = 0; i < 20; i++) handleQueued(7 + i);
reject(30);
for (let i = 0; i < 10; i++) handleQueued(i % 2 ? -1 : 0);
for (let i = 0; i < 10; i++) handleQueued(-2 - i);
await turn("middle");

// Most of a long queue, in three orders.
reject(2400);
for (let i = 0; i < 1600; i++) handleQueued(0);
reject(50);
await turn("oldest first");
reject(2400);
for (let i = 0; i < 1600; i++) handleQueued(1 + ((i * 7919) % (queued.length - 2)));
reject(50);
for (let i = 0; i < 450; i++) handleQueued(i % 3 === 0 ? 0 : i % 3 === 1 ? -1 : (i * 31) % queued.length);
await turn("scattered");
reject(2400);
for (let i = 0; i < 2390; i++) handleQueued(-1);
await turn("newest first");
while (reported.length > 100) handleReported((reported.length * 7) % reported.length);
await turn("reported, many");

// A seeded random walk over all of the above.
let seed = 0x2545f491;
const random = limit => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % limit;
};
for (let step = 0; step < 1200; step++) {
  const op = random(100);
  if (op < 30) reject(1 + random(40));
  else if (op < 50 && queued.length) handleQueued(0);
  else if (op < 70 && queued.length) handleQueued(-1);
  else if (op < 96 && queued.length) handleQueued(random(queued.length));
  else if (op < 98 && reported.length) handleReported(random(reported.length));
  else if (op === 99) await turn(`random walk, step ${step}`);
}
await turn("random walk, end");
console.log("ok");
