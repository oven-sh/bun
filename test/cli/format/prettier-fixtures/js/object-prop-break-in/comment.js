function foo() {
  return {
    // this comment causes the problem
    bar: baz() + 1
  };
}
