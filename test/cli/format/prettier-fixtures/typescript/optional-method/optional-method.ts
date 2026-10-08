// #6678

class Foo {
  [bar.bar]?() {}
}

// https://github.com/prettier/prettier/issues/6569#issuecomment-542888410
const s = Symbol();
class A {
  protected [s]?() {

  }
}
