// C11 7.25 <tgmath.h> with complex arguments: the macros that have complex counterparts call them, and the
// complex-only ones take real arguments as complex numbers. (Microsoft's library has no _Complex types.)
#include <complex.h>
#include <stdio.h>
#include <tgmath.h>

#define KIND(x) _Generic((x), float: "f", double: "d", long double: "l", float _Complex: "cf", double _Complex: "cd", default: "?")

int main(void) {
  float _Complex cf = 3.0f + 4.0f * I; double _Complex cd = -1.0 + 0.0 * I; float f = 2.0f; double d = 2.0;
  printf("%s %s %s %s %s %s\n", KIND(sqrt(cf)), KIND(sqrt(cd)), KIND(exp(cf)), KIND(pow(cf, d)), KIND(pow(f, cd)), KIND(cos(cd)));
  printf("%s %s %s %s %s\n", KIND(fabs(cf)), KIND(fabs(cd)), KIND(creal(cf)), KIND(cimag(cd)), KIND(conj(cf)));
  printf("%s %s %s\n", KIND(carg(f)), KIND(creal(d)), KIND(conj(d)));
  double _Complex root = sqrt(cd);
  printf("%g %g | %g %g | %g %g\n", (double)fabs(cf), fabs(cd), creal(root), cimag(root), (double)creal(conj(cf)), (double)cimag(conj(cf)));
  return 0;
}
