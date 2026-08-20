module.exports = {
  foo: 1,
  [Symbol.iterator]: function* () {
    yield 42;
  },
};
