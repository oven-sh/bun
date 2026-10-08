// https://github.com/prettier/prettier/issues/18834
type A1 = /* 1 */ | T1;
type A2 = /* 1 */ | (T2);
type A3 = (/* 1 */ | T3);
type A4 = /* 1 */ | /* 2 */ T4;
type A5 = /* 1 */ | (/* 2 */ T5);
type A6 = /* 0 */ /* 1 */ | /* 2 */ T6;
type A7 = /* 0 */ | /* 1 */ T7;
type A8 /* = */ /* 1:before */ = /* 2 */ | /* 3 */ T7;
