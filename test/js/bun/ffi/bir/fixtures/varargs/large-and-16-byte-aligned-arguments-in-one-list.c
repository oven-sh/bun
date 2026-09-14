// A variable argument list that mixes what is passed by address (a structure of more than 16 bytes), what is aligned
// to 16 bytes (a 128-bit integer, a structure that holds one, a long double where it has 16 bytes) and homogeneous
// floating aggregates of every length: the reader finds each where the caller put it, whatever came before it. On
// Apple's arm64 every one of these has a rule of its own about the stack slots it takes.
#include <stdarg.h>
#include <stdio.h>

typedef struct { long long a, b, c; } Big24;
typedef struct { long long a, b, c, d, e; } Big40;
typedef struct { __int128 v; } Wide;
typedef struct { _Alignas(16) long long a; } Aligned;
typedef struct { double a, b; } D2;
typedef struct { double a, b, c; } D3;
typedef struct { double a, b, c, d; } D4;
typedef struct { float a, b, c; } F3;
typedef struct { float a, b, c, d; } F4;

// What follows `n` is described by `format`: one letter per argument.
static void read_list(const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  for (const char *f = format; *f; f++) {
    switch (*f) {
      case 'i': printf(" i%d", va_arg(ap, int)); break;
      case 'l': printf(" l%lld", va_arg(ap, long long)); break;
      case 'd': printf(" d%g", va_arg(ap, double)); break;
      case 'w': { __int128 v = va_arg(ap, __int128); printf(" w%lld:%lld", (long long)(v >> 64), (long long)v); break; }
      case 'W': { Wide v = va_arg(ap, Wide); printf(" W%lld:%lld", (long long)(v.v >> 64), (long long)v.v); break; }
      case 'A': { Aligned v = va_arg(ap, Aligned); printf(" A%lld", v.a); break; }
      case 'B': { Big24 v = va_arg(ap, Big24); printf(" B%lld,%lld,%lld", v.a, v.b, v.c); break; }
      case 'C': { Big40 v = va_arg(ap, Big40); printf(" C%lld,%lld,%lld,%lld,%lld", v.a, v.b, v.c, v.d, v.e); break; }
      case '2': { D2 v = va_arg(ap, D2); printf(" 2:%g,%g", v.a, v.b); break; }
      case '3': { D3 v = va_arg(ap, D3); printf(" 3:%g,%g,%g", v.a, v.b, v.c); break; }
      case '4': { D4 v = va_arg(ap, D4); printf(" 4:%g,%g,%g,%g", v.a, v.b, v.c, v.d); break; }
      case 'f': { F3 v = va_arg(ap, F3); printf(" f:%g,%g,%g", v.a, v.b, v.c); break; }
      case 'F': { F4 v = va_arg(ap, F4); printf(" F:%g,%g,%g,%g", v.a, v.b, v.c, v.d); break; }
    }
  }
  va_end(ap);
  printf("\n");
}

// The same with the registers used up by named parameters first.
static void after_registers(long long a, long long b, long long c, long long d, long long e, long long f, long long g, long long h, double i, double j, double k, double l,
                            double m, double n, double o, double p, Big24 named_on_the_stack, const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  printf("%lld %g %lld |", a + b + c + d + e + f + g + h, i + j + k + l + m + n + o + p, named_on_the_stack.b);
  for (const char *s = format; *s; s++) {
    switch (*s) {
      case 'l': printf(" l%lld", va_arg(ap, long long)); break;
      case 'w': { __int128 v = va_arg(ap, __int128); printf(" w%lld:%lld", (long long)(v >> 64), (long long)v); break; }
      case 'B': { Big24 v = va_arg(ap, Big24); printf(" B%lld,%lld,%lld", v.a, v.b, v.c); break; }
      case '4': { D4 v = va_arg(ap, D4); printf(" 4:%g,%g,%g,%g", v.a, v.b, v.c, v.d); break; }
      case 'A': { Aligned v = va_arg(ap, Aligned); printf(" A%lld", v.a); break; }
    }
  }
  va_end(ap);
  printf("\n");
}

int main(void) {
  Big24 big = { 1, 2, 3 };
  Big40 bigger = { 4, 5, 6, 7, 8 };
  __int128 wide = ((__int128)9 << 64) | 10;
  Wide held = { ((__int128)11 << 64) | 12 };
  Aligned aligned = { 13 };
  D2 d2 = { 1.5, 2.5 };
  D3 d3 = { 3.5, 4.5, 5.5 };
  D4 d4 = { 6.5, 7.5, 8.5, 9.5 };
  F3 f3 = { 0.5f, 0.25f, 0.125f };
  F4 f4 = { 1.5f, 1.25f, 1.125f, 1.0625f };
  read_list("Bw", big, wide);
  read_list("iBw", 1, big, wide);
  read_list("BBw", big, big, wide);
  read_list("CwB", bigger, wide, big);
  read_list("lBWl", 20LL, big, held, 21LL);
  read_list("BAl", big, aligned, 22LL);
  read_list("iAiA", 1, aligned, 2, aligned);
  read_list("234", d2, d3, d4);
  read_list("4w3", d4, wide, d3);
  read_list("i4i3i2", 1, d4, 2, d3, 3, d2);
  read_list("fFd", f3, f4, 2.5);
  read_list("dddddddddfd", 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, f3, 10.0);
  read_list("lllllllllBw", 1LL, 2LL, 3LL, 4LL, 5LL, 6LL, 7LL, 8LL, 9LL, big, wide);
  after_registers(1, 2, 3, 4, 5, 6, 7, 8, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, big, "Bw", big, wide);
  after_registers(1, 2, 3, 4, 5, 6, 7, 8, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, big, "lw4A", 30LL, wide, d4, aligned);
  return 0;
}
