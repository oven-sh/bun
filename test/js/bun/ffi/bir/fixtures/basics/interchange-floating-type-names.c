/* The _FloatN names of C23 Annex H, which glibc's headers use as keywords when the compiler
   says it is a recent GNU C. */
#include <stdio.h>
_Float64 f64(_Float32 x) { _Float32x y = x; return y; }
extern __float128 q; extern _Complex _Float128 cq; extern _Float64x e;
int sizes(void) { return sizeof q * 10000 + sizeof cq * 100 + sizeof e; }
int main(void) {
  printf("%g\n", (double)f64(1.5f));
  printf("%d\n", sizes());
  return 0;
}
