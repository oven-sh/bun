class Foo {
  @deco([
    foo,
    bar
  ]) prop = value;

  @decorator([]) method() {}

  @decorator([
  ]) method() {}

  @decorator({}) method() {}

  @decorator({
  }) method() {}
}
