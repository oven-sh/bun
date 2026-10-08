class C {
  f(
    superSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperLong,
    ...args
  ) {}
}

function f(
  superSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperLong,
  ...args
) {}

class D { f(...superSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperLong) {}; }

[superSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperSuperLong,,];

[veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong, ...a] = [];
var {veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong, ...a} = {};

