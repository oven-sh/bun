class C {
  static #x = 42;
  static y;
  static {
    try {
      this.y = doSomethingWith(this.#x);
    } catch {
      this.y = "unknown";
    }
  }
}
  
class Foo {
  static {}
}
  
class A1 {
  static {
    foo;
  }
}
  
class A2 {
  static {
    foo;
    bar;
  }
}
  