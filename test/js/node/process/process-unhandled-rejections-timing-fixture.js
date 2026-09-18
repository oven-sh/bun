// Times how long it takes to attach a handler to each of n promises that were
// rejected, with no handler, one microtask turn earlier. Prints one JSON object.
// usage: <n> <limit: how many times the baseline an order may take>
const n = Number(process.argv[2]);
const limit = Number(process.argv[3]);
const reason = new Error("rejected");
const noop = () => {};

// The promises an attempt gives up on stay unhandled. Report them to nobody.
process.on("unhandledRejection", noop);

// With tracked = false every promise has a handler from the start, so attaching
// another never reaches the rejection tracker: that is the baseline for this
// machine and this build.
async function attachLate(order, tracked, budgetMs) {
  let promises = [];
  for (let i = 0; i < n; i++) {
    const promise = Promise.reject(reason);
    if (!tracked) promise.catch(noop);
    promises.push(promise);
  }
  await null;
  if (order === "reverse") promises.reverse();
  // 7919 is prime and does not divide n, so this visits every promise once.
  if (order === "scattered") promises = promises.map((_, i) => promises[(i * 7919) % n]);
  Bun.gc(true);
  const start = performance.now();
  let handled = 0;
  while (handled < n) {
    promises[handled++].catch(noop);
    // Unfixed, the whole loop takes minutes. Stop once the answer is known.
    if ((handled & 63) === 0 && performance.now() - start > budgetMs) break;
  }
  const ms = performance.now() - start;
  // Let the reactions run and let what is still unhandled be reported.
  await new Promise(resolve => setImmediate(resolve));
  return { ms, handled };
}

const results = {};
for (const order of ["forward", "reverse", "scattered"]) {
  // Up to three attempts, so that one slow attempt on a busy machine does not decide the result.
  for (let attempt = 0; attempt < 3; attempt++) {
    const baseline = await attachLate(order, false, Infinity);
    const tracked = await attachLate(order, true, baseline.ms * limit);
    const withinLimit = tracked.handled === n && tracked.ms <= baseline.ms * limit;
    results[order] = { baselineMs: baseline.ms, trackedMs: tracked.ms, handled: tracked.handled, withinLimit };
    if (withinLimit) break;
  }
}
console.log(JSON.stringify(results));
