type A1 = a /* 1 */ | b;
type A2 = a | /* 1 */ b;
type A3 = (a /* 1 */) | b;
type A4 = a | (/* 1 */ b);
type A5 = (a) /* 1 */ | b;
type A6 = a | /* 1 */ (b);

type B1 = a /* 1 */ /* 2 */ | b;
type B2 = a /* 1 */ | /* 2 */ b;
type B3 = a | /* 1 */ /* 2 */ b;
