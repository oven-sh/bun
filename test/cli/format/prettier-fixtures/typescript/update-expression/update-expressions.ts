// https://github.com/typescript-eslint/typescript-eslint/blob/c3767edf65716be08df25723d7dbb770de0e7037/packages/ast-spec/src/expression/UpdateExpression/fixtures/valid-assignment/fixture.ts
class F {
  #a;

  m() {
    this.#a++;
    this.m().a++;
    this[1] = 1;
    F++;
    (this.#a)++;
    (<number>this.#a)++;
    (this.#a satisfies number)++;
    (this.#a as number)++;
    this.#a!++;
  }
}
