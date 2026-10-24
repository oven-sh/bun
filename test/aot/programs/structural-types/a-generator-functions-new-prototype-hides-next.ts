function* numbers(): Generator<number, void, void> {
  yield 1;
}

const view: { prototype: unknown } = numbers;
view.prototype = Object.create(Object(view.prototype), {
  next: {
    value(): IteratorResult<number, void> {
      return { done: true, value: undefined };
    },
  },
});

console.log("zzqq " + numbers().next().done);
