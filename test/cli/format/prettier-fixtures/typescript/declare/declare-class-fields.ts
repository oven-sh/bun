class B {p: number;}
class C extends B {declare p: 256 | 1000;}
class D {
  declare field = "field";
}
declare class D {
  field = "field";
}
