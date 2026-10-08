class Foo {
  static prop = 1
  static {
    console.log(Foo.prop++);
  }
  static {
    console.log(Foo.prop++);
  }
  static {
    console.log(Foo.prop++);
  }
}
