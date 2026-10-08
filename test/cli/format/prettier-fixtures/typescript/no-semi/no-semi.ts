class A {
  bar: A;
  [baz]

  // none of the semicolons above this comment can be omitted.
  // none of the semicolons below this comment are necessary.

  bar: A;
  private [baz]
  readonly [qux]
}
