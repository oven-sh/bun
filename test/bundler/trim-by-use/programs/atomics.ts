const shared = new Int32Array(new SharedArrayBuffer(16));
console.log(
  Atomics.add(shared, 0, 5),
  Atomics.load(shared, 0),
  Atomics.compareExchange(shared, 0, 5, 9),
  Atomics.exchange(shared, 1, 3),
  Atomics.or(shared, 1, 4),
  Atomics.load(shared, 1),
);
console.log(
  Atomics.isLockFree(4),
  Atomics.notify(shared, 0, 1),
  Atomics.wait(shared, 0, 0, 1),
  Atomics.wait(shared, 0, 9, 1),
);
const later: any = (Atomics as any).waitAsync(shared, 0, 9, 5);
console.log(later.async, await later.value);
