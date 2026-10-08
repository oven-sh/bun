
export type A = (
  | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  | bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
);

export type B = (
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
);

export type C =
  | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  | bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;

export type D =
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;

export type Multi = (string | number)[];

function f(): (string | number) {}

var x: (string | number);
var y: ((string | number));

class Foo<T extends (string | number)> {}

interface Interface {
    i: (X | Y) & Z;
    j: Partial<(X | Y)>;
}

type State = {
  sharedProperty: any;
} & (
  | { discriminant: "FOO"; foo: any }
  | { discriminant: "BAR"; bar: any }
  | { discriminant: "BAZ"; baz: any }
);

const foo1 = [abc, def, ghi, jkl, mno, pqr, stu, vwx, yz] as (
  | string
  | undefined
)[];

const foo2: (
  | AAAAAAAAAAAAAAAAAAAAAA
  | BBBBBBBBBBBBBBBBBBBBBB
  | CCCCCCCCCCCCCCCCCCCCCC
  | DDDDDDDDDDDDDDDDDDDDDD
)[] = [];

const foo3: keyof (
  | AAAAAAAAAAAAAAAAAAAAAA
  | BBBBBBBBBBBBBBBBBBBBBB
  | CCCCCCCCCCCCCCCCCCCCCC
  | DDDDDDDDDDDDDDDDDDDDDD
) = bar;

const foo4:
  | foo
  | (
      | AAAAAAAAAAAAAAAAAAAAAA
      | BBBBBBBBBBBBBBBBBBBBBB
      | CCCCCCCCCCCCCCCCCCCCCC
      | DDDDDDDDDDDDDDDDDDDDDD
    ) = bar;

let a1 : C;
let a2 : | C;
let a3 : (| C);
let a4 : | (C);
let a5 : (| (C));
let a6 : /*1*/ | C;
let a7 : /*1*/ | (C);
let a8 : /*1*/ (| C);
let a9 : (/*1*/ | C);
let a10: /*1*/ | /*2*/ C;
let a11: /*1*/ (| /*2*/ C);

let aa1: /*1*/ | /*2*/ C | D;
let aa2: /*1*/ | /*2*/ C | /*3*/ D;
let aa3: /*1*/ | /*2*/ C | /*3*/ D /*4*/;

type A1  = C;
type A2  = | C;
type A3  = (| C);
type A4  = | (C);
type A5  = (| (C));
type A6  = /*1*/ | C;
type A7  = /*1*/ | (C);
type A8  = /*1*/ (| C);
type A9  = (/*1*/ | C);
type A10 = /*1*/ | /*2*/ C;
type A11 = /*1*/ (| /*2*/ C);
type A12 = /*1*/ | ( (C));
type A13 = /*1*/ ( (C));

type Aa1 = /*1*/ | /*2*/ C | D;
type Aa2 = /*1*/ | /*2*/ C | /*3*/ D;
type Aa3 = /*1*/ | /*2*/ C | /*3*/ D /*4*/;

type C1 = /*1*/ & a | b;
type C2 = /*1*/ & a | (b);
type C3 = /*1*/ & a | (& b);
type C4 = /*1*/ & (a | b);
type C5 = /*1*/ (& a | b);
type C6 /*0*/ = /*1*/ (& a | b);

type Ctor = (new () => X) | Y;
