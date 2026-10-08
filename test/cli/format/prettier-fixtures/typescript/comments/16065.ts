class Foo {
  constructor(
    @decorator1
    // comment1
    readonly baz1: string,

    @decorator2
    // comment2
    private baz2: string,
  ) {}
}
