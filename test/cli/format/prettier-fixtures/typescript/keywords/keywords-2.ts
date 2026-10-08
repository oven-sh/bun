// https://github.com/babel/babel/pull/12356

class C {
  private *a() {}
  public *b() {}
  static *c() {}
  protected *g() {}
}

class D {
  declare<T>() {}
  readonly<T>() {}
  abstract<T>() {}
  static<T>() {}
  private<T>() {}
  public<T>() {}
  protected<T>() {}
}

class E {
  public
  private() {}
}

class Foo {
  constructor(private, public, static) {
  }
}
