class A // comment 1
  // comment 2
  extends B {}

class A1 extends B // comment1
// comment2
// comment3
{}

class A2 /* a */ extends B {}
class A3 extends B /* a */ {}
class A4 extends /* a */ B {}

(class A5 // comment 1
  // comment 2
  extends B {});

(class A6 extends B // comment1
// comment2
// comment3
{});

(class A7 /* a */ extends B {});
(class A8 extends B /* a */ {});
(class A9 extends /* a */ B {});

class a extends b // comment
{
  constructor() {}
}

class c extends d
// comment2
{
  constructor() {}
}

class C2  // comment
extends Base
{  foo(){} }

(class A10 extends /* a */ /* prettier-ignore */B {});
class A10 extends /* a */ /* prettier-ignore */B {}
