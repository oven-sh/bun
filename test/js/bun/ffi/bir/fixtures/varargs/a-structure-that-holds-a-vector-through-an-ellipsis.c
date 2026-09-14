// A structure with a vector member read with va_arg, next to plain vectors and scalars. (On x86-64 System V this
// compiler refuses it, with a diagnostic the cases have; where the variable arguments are all on the stack it works.)
#include <stdarg.h>
#include <stdio.h>

typedef float V __attribute__((vector_size(16)));
typedef int I __attribute__((vector_size(16)));
struct One { V v; };
struct Two { V v; I i; };
struct Mixed { int tag; V v; };

static void read_list(const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  for (const char *f = format; *f; f++) {
    switch (*f) {
      case 'i': printf(" i%d", va_arg(ap, int)); break;
      case 'd': printf(" d%g", va_arg(ap, double)); break;
      case '1': { struct One s = va_arg(ap, struct One); printf(" 1:%g,%g,%g,%g", s.v[0], s.v[1], s.v[2], s.v[3]); break; }
      case '2': { struct Two s = va_arg(ap, struct Two); printf(" 2:%g,%g/%d,%d", s.v[0], s.v[3], s.i[0], s.i[3]); break; }
      case 'm': { struct Mixed s = va_arg(ap, struct Mixed); printf(" m%d:%g,%g", s.tag, s.v[0], s.v[3]); break; }
      case 'v': { V v = va_arg(ap, V); printf(" v%g,%g", v[0], v[3]); break; }
    }
  }
  va_end(ap);
  printf("\n");
}

int main(void) {
  struct One one = { { 1.5f, 2.5f, 3.5f, 4.5f } };
  struct Two two = { { 5.5f, 6.5f, 7.5f, 8.5f }, { 9, 10, 11, 12 } };
  struct Mixed mixed = { 13, { 14.5f, 15.5f, 16.5f, 17.5f } };
  V plain = { 18.5f, 19.5f, 20.5f, 21.5f };
  // (Three calls that Apple's own compiler reads the same at every optimization level. With a structure that holds a
  // vector after a 4-byte argument, or after the registers are used up, it reads garbage or crashes once it optimizes,
  // so there is nothing for those to agree with.)
  read_list("1", one);
  read_list("2m", two, mixed);
  read_list("iv1d", 3, plain, one, 0.25);
  return 0;
}
