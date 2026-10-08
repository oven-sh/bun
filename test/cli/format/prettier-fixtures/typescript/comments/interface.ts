interface Foo {
  bar(
    currentRequest: {a: number},
    // TODO this is a very very very very long comment that makes it go > 80 columns
  ): number;

  (
    currentRequest: {a: number},
    // TODO this is a very very very very long comment that makes it go > 80 columns
  ): number;

  new (
    currentRequest: {a: number},
    // TODO this is a very very very very long comment that makes it go > 80 columns
  ): number;

  foo: {
    x(
      currentRequest: {a: number},
      // TODO this is a very very very very long comment that makes it go > 80 columns
    ): number;

    y: (
      currentRequest: {a: number},
      // TODO this is a very very very very long comment that makes it go > 80 columns
    ) => number;
  }
}
