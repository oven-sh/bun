// A scalar operand of a lane-wise operation is converted to the element type and copied into every lane, where that
// keeps its value: a constant that is a value of the element type, a narrower or equally wide integer, an integer
// into floating lanes that hold all of its digits, a float into double lanes; the count of a shift is any integer.
// (What would lose something is an error: diagnostics/cases.json.)
#include <stdio.h>

typedef int v4 __attribute__((vector_size(16)));
typedef unsigned u4 __attribute__((vector_size(16)));
typedef short v8 __attribute__((vector_size(16)));
typedef long long l2 __attribute__((vector_size(16)));
typedef float f4 __attribute__((vector_size(16)));
typedef double d2 __attribute__((vector_size(16)));

int main(void) {
  volatile int i = 3;
  volatile short s = -2;
  volatile char c = 5;
  volatile float f = 0.5f;
  volatile long long wide = 40;
  v4 a = { 1, 2, 3, 4 };
  v8 h = { 1, 2, 3, 4, 5, 6, 7, 8 };
  l2 l = { 1, -1 };
  f4 x = { 1, 2, 3, 4 };
  d2 d = { 1, 2 };
  u4 u = { 1, 2, 3, 4 };
  v4 r1 = a + 1LL, r2 = a + i, r3 = c + a, r4 = a * 3000000000u, r5 = a << wide % 8, r6 = a == 2;
  u4 r7 = u + -1, r8 = u + i;
  v8 r9 = h + s, r10 = h - 100, r11 = h << c;
  l2 r12 = l + i, r13 = l * 5000000000LL;
  f4 r14 = x + 1, r15 = x + 1.0, r16 = x * s, r17 = x + f, r18 = x + 16777218;
  d2 r19 = d + i, r20 = d + f, r21 = d * 0.1;
  printf("%d %d %d %d %d %d\n", r1[3], r2[3], r3[3], r4[1], r5[3], r6[1]);
  printf("%u %u\n", r7[0], r8[3]);
  printf("%d %d %d\n", r9[7], r10[0], r11[1]);
  printf("%lld %lld\n", r12[1], r13[0]);
  printf("%g %g %g %g %g\n", r14[0], r15[1], r16[2], r17[3], r18[0]);
  printf("%g %g %g\n", r19[1], r20[0], r21[1]);
  return 0;
}
