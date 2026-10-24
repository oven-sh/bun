// Generators chained into a pipeline, `yield*` over a tree and a class with an iterator of its own, consumed by `for of`, spread, destructuring and entries().
function* range(from, to, step = 1) {
  for (let value = from; value < to; value += step) yield value;
}

function* map(source, fn) {
  for (const value of source) yield fn(value);
}

function* filter(source, test) {
  for (const value of source) if (test(value)) yield value;
}

function* take(source, count) {
  if (count <= 0) return;
  for (const value of source) {
    yield value;
    if (--count === 0) return;
  }
}

class Ring {
  constructor(items) {
    this.items = items;
  }
  [Symbol.iterator]() {
    let at = 0;
    const items = this.items;
    return {
      next() {
        if (at < items.length) return { value: items[at++], done: false };
        return { value: undefined, done: true };
      },
    };
  }
}

function* walk(tree) {
  yield tree.value;
  for (const child of tree.children) yield* walk(child);
}

function sum(source) {
  let total = 0;
  for (const value of source) total += value;
  return total;
}

function run(rounds) {
  const ring = new Ring([1, 2, 3, 4, 5, 6, 7, 8]);
  const tree = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }, { value: 4, children: [] }] };
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    total += sum(take(filter(map(range(0, 100), x => x * 3), x => x % 2 === 0), 10));
    total += sum(ring) + sum(walk(tree));
    const [first, second] = range(i & 7, 100);
    total += first + second + Math.max(...ring) + [...range(0, 5)].length;
    for (const [index, value] of [10, 20, 30].entries()) total += index * value;
  }
  return total;
}

console.log(run(120000));
