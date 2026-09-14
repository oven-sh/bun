// The real and imaginary parts of a complex object are where they are whatever qualifiers
// the lvalue that reaches it has.
#include <stdio.h>

typedef struct { _Complex float c; } CF;
typedef struct { _Complex double c; } CD;
typedef struct { __int128 v; } WI;

const _Complex float file_scope_f = 1.5f + 2.5fi;
const _Complex double file_scope_d = 1.5 + 2.5i;
const volatile _Complex float file_scope_cv = 3.5f + 4.5fi;
static const _Complex float table[2] = { 1.0f + 2.0fi, 3.0f + 4.0fi };

static void f(const char *what, float re, float im) { printf("%s: %g %g\n", what, re, im); }
static void d(const char *what, double re, double im) { printf("%s: %g %g\n", what, re, im); }

static __attribute__((noinline)) float imag_of_parameter(const _Complex float z) { return __imag__ z; }
static __attribute__((noinline)) double imag_through_pointer(const volatile _Complex double *z) { return __imag__ *z; }
static __attribute__((noinline)) long long high_half(const volatile WI *w) { return (long long)(w->v >> 64); }

int main(void) {
  CF a;
  a.c = 3.5f + 4.5fi;
  const CF *pa = &a;
  volatile CF *va = &a;
  const volatile CF *cva = &a;
  f("const struct pointer", __real__ pa->c, __imag__ pa->c);
  f("volatile struct pointer", __real__ va->c, __imag__ va->c);
  f("const volatile struct pointer", __real__ cva->c, __imag__ cva->c);
  f("file scope const", __real__ file_scope_f, __imag__ file_scope_f);
  f("file scope const volatile", __real__ file_scope_cv, __imag__ file_scope_cv);
  f("const array element", __real__ table[1], __imag__ table[1]);
  f("const parameter", 0, imag_of_parameter(7.0f + 8.0fi));

  CD b;
  b.c = 3.5 + 4.5i;
  const CD *pb = &b;
  d("double: const struct pointer", __real__ pb->c, __imag__ pb->c);
  d("double: file scope const", __real__ file_scope_d, __imag__ file_scope_d);
  d("double: through a pointer", 0, imag_through_pointer(&b.c));

  // Writes through a volatile lvalue, and the operators that read and write.
  volatile _Complex float z = 3.5f + 4.5fi;
  float guard_after = 99.0f;
  z++;
  f("after ++", __real__ z, __imag__ z);
  z--;
  --z;
  f("after -- twice", __real__ z, __imag__ z);
  z += 1.0f + 1.0fi;
  f("after +=", __real__ z, __imag__ z);
  __imag__ z = 9.0f;
  __real__ z = -1.0f;
  f("after writing the parts", __real__ z, __imag__ z);
  va->c = z;
  __imag__ va->c = 2.0f;
  f("written through a volatile struct pointer", __real__ a.c, __imag__ a.c);
  printf("the neighbour is untouched: %g\n", guard_after);

  volatile _Complex double w = 3.5 + 4.5i;
  w++;
  __imag__ w += 1.0;
  d("double: after ++ and += on a part", __real__ w, __imag__ w);

  // 128-bit integers share the layout code: the halves are 8 bytes each under every qualifier.
  WI wide = { ((__int128)5 << 64) | 6 };
  const volatile __int128 cv = ((__int128)7 << 64) | 8;
  volatile __int128 counter = ((__int128)1 << 64) - 1;
  counter++;
  printf("halves: %lld %lld %lld %lld %lld\n", high_half(&wide), (long long)wide.v, (long long)(cv >> 64), (long long)cv, (long long)(counter >> 64));
  return 0;
}
