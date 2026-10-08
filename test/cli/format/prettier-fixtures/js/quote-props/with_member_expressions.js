const obj = {
  foo: "",
  [foo.bar]: ""
};

class Foo {
  foo() {}
  [foo.bar]() {}
}
