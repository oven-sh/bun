// Number parameters passed on in tail position, called through `any`: a number arrives unboxed, nullish passes the test, any other value throws.
function scale(x: number, y: number) { return x * y; }
function twice(a: number, b: number) { return scale(b, a); }
const untyped: any = twice;
function attempt(a: any, b: any) {
  try {
    console.log(untyped(a, b));
  } catch (error) {
    console.log((error as Error).name);
  }
}
attempt(1, 2);
attempt(1.5, -0);
attempt(2 ** 31, NaN);
attempt("1", 2);
attempt(1, undefined);
attempt({}, 1);
