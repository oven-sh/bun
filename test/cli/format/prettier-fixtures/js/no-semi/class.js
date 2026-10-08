// TODO: upgrade parser
// class A {
//   async; // The semicolon is *not* necessary
//   x(){}
// }
// class B {
//   static; // The semicolon *is* necessary
//   x(){}
// }

class C1 {
  get; // The semicolon *is* necessary
  x(){}
}
class C2 {
  get = () => {}; // The semicolon is *not* necessary
  x(){}
}
class C3 {
  set; // The semicolon *is* necessary
  x(){}
}
class C4 {
  set = () => {}; // The semicolon is *not* necessary
  x(){}
}



class A1 {
  a = 0;
  [b](){}

  c = 0;
  *d(){}

  e = 0;
  [f] = 0

  // none of the semicolons above this comment can be omitted.
  // none of the semicolons below this comment are necessary.

  q() {};
  [h](){}

  p() {};
  *i(){}

  a = 1;
  get ['y']() {}

  a = 1;
  static ['y']() {}

  a = 1;
  set ['z'](z) {}

  a = 1;
  async ['a']() {}

  a = 1;
  async *g() {}

  a = 0;
  b = 1;
}

class A2 {
  a = 0;
  [b](){}

  c = 0;
  *d(){}

  e = 0;
  [f] = 0

  // none of the semicolons above this comment can be omitted.
  // none of the semicolons below this comment are necessary.

  q() {};
  [h](){}

  p() {};
  *i(){}

  a = 1;
  get ['y']() {}

  a = 1;
  static ['y']() {}

  a = 1;
  set ['z'](z) {}

  a = 1;
  async ['a']() {}

  a = 1;
  async *g() {}

  a = 0;
  b = 1;
}

// being first/last shouldn't break things
class G1 {
  x = 1
}
class G2 {
  x() {}
}
class G3 {
  *x() {}
}
class G4 {
  [x] = 1
}
