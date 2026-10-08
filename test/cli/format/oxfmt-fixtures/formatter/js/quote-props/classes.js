// Class with no quotes needed
class A {
  a = "a";
}

// Class with quotes preserved
class B {
  'b' = "b";
}

// Class with mixed - consistent should quote all
class C {
  c1 = "c1";
  'c2' = "c2";
}

// Class with required quotes - consistent should quote all
class D {
  d1 = "d1";
  'd-2' = "d2";
}

// Class with methods
class E {
  method1() {}
  'method-2'() {}
}

// Class with getter/setter methods
class F {
  get getter1() { return 1; }
  get 'getter-2'() { return 2; }
  set setter1(v) {}
  set 'setter-2'(v) {}
}

// Class with auto-accessors (ES2022) - consistent should quote all
class G {
  accessor prop1 = 1;
  accessor 'prop-2' = 2;
}
