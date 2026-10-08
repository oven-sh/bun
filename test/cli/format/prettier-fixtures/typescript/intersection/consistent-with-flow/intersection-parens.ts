type A = (number | string) & boolean;
type B = ((number | string)) & boolean;
type C = (((number | string))) & boolean;
type D = ((((number | string)))) & boolean;

let b1 : C;
let b2 : & C;
let b3 : (& C);
let b4 : & (C);
let b5 : (& (C));
let b6 : /*1*/ & C;
let b7 : /*1*/ & (C);
let b8 : /*1*/ (& C);
let b9 : (/*1*/ & C);
let b10: /*1*/ & /*2*/ C;
let b11: /*1*/ (& /*2*/ C);

let bb1: /*1*/ & /*2*/ C & D;
let bb2: /*1*/ & /*2*/ C & /*3*/ D;
let bb3: /*1*/ & /*2*/ C & /*3*/ D /*5*/;

type B2  = & C;
type B3  = (& C);
type B4  = & (C);
type B5  = (& (C));
type B6  = /*1*/ & C;
type B7  = /*1*/ & (C);
type B8  = /*1*/ (& C);
type B9  = (/*1*/ & C);
type B10 = /*1*/ & /*2*/ C;
type B11 = /*1*/ (& /*2*/ C);
type B12 = /*1*/ & ( (C));

type Bb1 = /*1*/ & /*2*/ C & D;
type Bb2 = /*1*/ & /*2*/ C & /*3*/ D;
type Bb3 = /*1*/ & /*2*/ C & /*3*/ D /*4*/;

type D1 = /*1*/ | a & b;
type D2 = /*1*/ | a & (b);
type D3 = /*1*/ | a & (| b);
type D4 = /*1*/ | (a & b);
type D5 = /*1*/ (| a & b);
type D6 /*0*/ = /*1*/ (| a & b);
