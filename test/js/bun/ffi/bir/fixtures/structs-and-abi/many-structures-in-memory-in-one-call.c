// Any number of structures passed by value in memory in one call: thirteen and more of over 64 bytes each (every
// one of which the caller copies into its outgoing arguments), mixed with enough integers and doubles to use up the
// argument registers, through a pointer to a function, to a variadic function, and structures from 72 bytes to a
// megabyte.
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct big { long long v[10]; };
struct odd { char c[65]; };
static struct big make(long long seed) { struct big b; for (int i = 0; i < 10; i++) b.v[i] = seed * 100 + i; return b; }
static long long total(struct big b) { long long t = 0; for (int i = 0; i < 10; i++) t += b.v[i]; return t; }

__attribute__((noinline)) static long long sum12(struct big a1, struct big a2, struct big a3, struct big a4, struct big a5, struct big a6, struct big a7, struct big a8, struct big a9, struct big a10, struct big a11, struct big a12) { return 1 * total(a1) + 2 * total(a2) + 3 * total(a3) + 4 * total(a4) + 5 * total(a5) + 6 * total(a6) + 7 * total(a7) + 8 * total(a8) + 9 * total(a9) + 10 * total(a10) + 11 * total(a11) + 12 * total(a12); }
__attribute__((noinline)) static long long sum13(struct big a1, struct big a2, struct big a3, struct big a4, struct big a5, struct big a6, struct big a7, struct big a8, struct big a9, struct big a10, struct big a11, struct big a12, struct big a13) { return 1 * total(a1) + 2 * total(a2) + 3 * total(a3) + 4 * total(a4) + 5 * total(a5) + 6 * total(a6) + 7 * total(a7) + 8 * total(a8) + 9 * total(a9) + 10 * total(a10) + 11 * total(a11) + 12 * total(a12) + 13 * total(a13); }
__attribute__((noinline)) static long long sum14(struct big a1, struct big a2, struct big a3, struct big a4, struct big a5, struct big a6, struct big a7, struct big a8, struct big a9, struct big a10, struct big a11, struct big a12, struct big a13, struct big a14) { return 1 * total(a1) + 2 * total(a2) + 3 * total(a3) + 4 * total(a4) + 5 * total(a5) + 6 * total(a6) + 7 * total(a7) + 8 * total(a8) + 9 * total(a9) + 10 * total(a10) + 11 * total(a11) + 12 * total(a12) + 13 * total(a13) + 14 * total(a14); }
__attribute__((noinline)) static long long sum20(struct big a1, struct big a2, struct big a3, struct big a4, struct big a5, struct big a6, struct big a7, struct big a8, struct big a9, struct big a10, struct big a11, struct big a12, struct big a13, struct big a14, struct big a15, struct big a16, struct big a17, struct big a18, struct big a19, struct big a20) { return 1 * total(a1) + 2 * total(a2) + 3 * total(a3) + 4 * total(a4) + 5 * total(a5) + 6 * total(a6) + 7 * total(a7) + 8 * total(a8) + 9 * total(a9) + 10 * total(a10) + 11 * total(a11) + 12 * total(a12) + 13 * total(a13) + 14 * total(a14) + 15 * total(a15) + 16 * total(a16) + 17 * total(a17) + 18 * total(a18) + 19 * total(a19) + 20 * total(a20); }

__attribute__((noinline)) static double mixed(long long i1, double d1, struct big a1, long long i2, double d2, struct big a2, long long i3, double d3, struct big a3, long long i4, double d4, struct big a4,
    long long i5, double d5, struct big a5, long long i6, double d6, struct big a6, long long i7, double d7, struct big a7, long long i8, double d8, struct big a8, double d9, struct big a9,
    struct big a10, struct big a11, struct big a12, struct big a13, struct big a14) {
  return i1 + 2 * i2 + 3 * i3 + 4 * i4 + 5 * i5 + 6 * i6 + 7 * i7 + 8 * i8 + d1 + d2 / 2 + d3 / 4 + d4 / 8 + d5 + d6 + d7 + d8 + d9
      + total(a1) + total(a2) + total(a3) + total(a4) + total(a5) + total(a6) + total(a7) + total(a8) + total(a9) + total(a10) + total(a11) + total(a12) + total(a13) + 3 * total(a14);
}
__attribute__((noinline)) static int odd_ones(struct odd a1, struct odd a2, struct odd a3, struct odd a4, struct odd a5, struct odd a6, struct odd a7, struct odd a8, struct odd a9, struct odd a10, struct odd a11, struct odd a12, struct odd a13, struct odd a14) { return a1.c[0] + a1.c[64] * 1 + a2.c[0] + a2.c[64] * 2 + a3.c[0] + a3.c[64] * 3 + a4.c[0] + a4.c[64] * 4 + a5.c[0] + a5.c[64] * 5 + a6.c[0] + a6.c[64] * 6 + a7.c[0] + a7.c[64] * 7 + a8.c[0] + a8.c[64] * 8 + a9.c[0] + a9.c[64] * 9 + a10.c[0] + a10.c[64] * 10 + a11.c[0] + a11.c[64] * 11 + a12.c[0] + a12.c[64] * 12 + a13.c[0] + a13.c[64] * 13 + a14.c[0] + a14.c[64] * 14; }
__attribute__((noinline)) static long long anonymous(int count, ...) {
  va_list list;
  va_start(list, count);
  long long t = 0;
  for (int i = 1; i <= count; i++) t += i * total(va_arg(list, struct big));
  va_end(list);
  return t;
}
static long long (*volatile pointer_to_sum14)(struct big a1, struct big a2, struct big a3, struct big a4, struct big a5, struct big a6, struct big a7, struct big a8, struct big a9, struct big a10, struct big a11, struct big a12, struct big a13, struct big a14) = sum14;

#define SIZED(n)                                                                                               \
  struct sized_##n { unsigned char bytes[n]; };                                                               \
  __attribute__((noinline)) static int ends_##n(struct sized_##n s, struct sized_##n t) { return s.bytes[0] + 256 * s.bytes[n - 1] + 65536 * t.bytes[n / 2]; }
SIZED(72) SIZED(256) SIZED(4096) SIZED(65536) SIZED(1048576)

int main(void) {
  struct big x1 = make(1);
  struct big x2 = make(2);
  struct big x3 = make(3);
  struct big x4 = make(4);
  struct big x5 = make(5);
  struct big x6 = make(6);
  struct big x7 = make(7);
  struct big x8 = make(8);
  struct big x9 = make(9);
  struct big x10 = make(10);
  struct big x11 = make(11);
  struct big x12 = make(12);
  struct big x13 = make(13);
  struct big x14 = make(14);
  struct big x15 = make(15);
  struct big x16 = make(16);
  struct big x17 = make(17);
  struct big x18 = make(18);
  struct big x19 = make(19);
  struct big x20 = make(20);
  printf("sum12 %lld\n", sum12(x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12));
  printf("sum13 %lld\n", sum13(x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13));
  printf("sum14 %lld\n", sum14(x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14));
  printf("sum20 %lld\n", sum20(x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14, x15, x16, x17, x18, x19, x20));
  printf("through a pointer %lld\n", pointer_to_sum14(x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14));
  printf("mixed %.4f\n", mixed(1, 0.5, x1, 2, 1.5, x2, 3, 2.5, x3, 4, 3.5, x4, 5, 4.5, x5, 6, 5.5, x6, 7, 6.5, x7, 8, 7.5, x8, 8.5, x9, x10, x11, x12, x13, x14));
  printf("anonymous %lld\n", anonymous(14, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14));
  struct odd o[14];
  for (int i = 0; i < 14; i++) { memset(&o[i], i + 1, sizeof o[i]); o[i].c[64] = 2; }
  printf("odd ones %d\n", odd_ones(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8], o[9], o[10], o[11], o[12], o[13]));
#define USE(n)                                                                  \
  {                                                                             \
    struct sized_##n *s = malloc(2 * sizeof *s);                                \
    memset(s, 0, 2 * sizeof *s);                                                \
    s[0].bytes[0] = 1, s[0].bytes[n - 1] = 2, s[1].bytes[n / 2] = 3;            \
    printf("%d bytes: %d\n", n, ends_##n(s[0], s[1]));                          \
    free(s);                                                                    \
  }
  USE(72) USE(256) USE(4096) USE(65536) USE(1048576)
  return 0;
}
