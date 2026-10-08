[
  @decorator() class {},
  @decorator() class A {},
];

class A {
  @decorator() accessor #field;
}

class B {
  @decorator() #field () {}
}
