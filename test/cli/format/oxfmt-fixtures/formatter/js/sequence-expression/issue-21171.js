// Issue #21171 - sequence expression in arrow function body
// Short sequence: should collapse to one line
const result = items.reduce(
  (acc, item) => (
    (acc[item.id] = item.value),
    acc
  ),
  {}
);

// Long sequence: should break to separate lines
const result2 = items.reduce(
  (acc, item) => (
    isLong(item) ? (acc[item.id] = { key: item.id, value: item.value }) : undefined,
    acc
  ),
  {}
);

// Three-item short sequence: should collapse
const result3 = (a, b) => (a++, b++, a + b);

// Three-item long sequence: should break
const result4 = (a, b) => (
  someVeryLongFunctionName(a),
  anotherVeryLongFunctionName(b),
  yetAnotherVeryLongFunctionName(a, b)
);

// Arrow chain returning a sequence (long): should break inside the tail
const chained = (a) => (b) => (c) => (
  isLong(a) ? (state[a] = { x: a, y: b, z: c }) : undefined,
  state
);

// Arrow chain returning a short sequence: should collapse
const chained2 = (a) => (b) => ((state[a] = b), state);

// Sequence as a top-level expression statement (not an arrow body):
// behavior should be unchanged by this fix.
a, b, c;
firstLongIdentifier, secondLongIdentifier, thirdLongIdentifier, fourthLongIdentifier;

// Sequence inside a for-loop update clause: behavior should be unchanged.
for (let i = 0, j = 10; i < j; i++, j--) {
  doSomething(i, j);
}
