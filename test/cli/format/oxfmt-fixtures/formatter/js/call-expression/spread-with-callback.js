// Issue #18930 - spread with arrow callback
target(...argument, () => {
  // code
});

// Issue #18971 - spread with arrow callback returning value
fn(...x, v => {
  return v;
});

// Additional test cases
foo(...args, (a, b) => {
  console.log(a, b);
});

bar(...items, function() {
  return 1;
});

// Multiple spreads
baz(...a, ...b, () => {
  return;
});

// Spread in the middle
qux(first, ...rest, () => {
  return;
});
