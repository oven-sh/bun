// Functional style with arrow functions: compose, pipe, curry with rest and spread arguments, closures that return closures, and a recursive flatten.
const compose = (...fns) => value => fns.reduceRight((result, fn) => fn(result), value);
const pipe = (...fns) => value => fns.reduce((result, fn) => fn(result), value);

const curry = fn => {
  const collect = (...args) => (args.length >= fn.length ? fn(...args) : (...more) => collect(...args, ...more));
  return collect;
};

const add = curry((a, b) => a + b);
const multiply = curry((a, b) => a * b);
const clamp = curry((low, high, value) => Math.min(high, Math.max(low, value)));
const prop = name => object => object[name];
const not = test => value => !test(value);
const isEven = value => value % 2 === 0;
const tap = fn => value => (fn(value), value);

function debounceLike(fn) {
  let calls = 0;
  return (...args) => (++calls % 3 === 0 ? fn(...args) : 0);
}

function zipWith(fn, left, right) {
  const out = [];
  for (let i = 0; i < Math.min(left.length, right.length); i++) out.push(fn(left[i], right[i]));
  return out;
}

const flatten = list => list.reduce((out, item) => (Array.isArray(item) ? out.concat(flatten(item)) : (out.push(item), out)), []);

function run(count) {
  let seen = 0;
  const transform = pipe(add(3), multiply(2), clamp(0, 50), tap(() => seen++));
  const back = compose(add(1), multiply(3));
  const everyThird = debounceLike((a, b) => a + b);
  const size = prop("size");
  const items = [{ size: 1 }, { size: 4 }, { size: 9 }];
  const nested = [1, [2, [3, 4]], [5], 6];
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += transform(i & 31) + back(i & 7) + everyThird(i & 3, 1);
    total += size(items[i % 3]) + (not(isEven)(i) ? 1 : 0);
    if ((i & 7) === 0) total += zipWith((a, b) => a * b, [1, 2, 3], [i & 3, 5, 6]).length + flatten(nested).length;
  }
  return total + seen;
}

console.log(run(900000));
