// The room for a structure passed by value is made at the call that passes it, not kept in the frame of every
// activation of the function the call is in: a function that recurses 20,000 deep and passes 16 KB by value once in
// a thousand levels needs 20,000 small frames and one large argument at a time, not 320 MB.
#include <stdio.h>

struct big { char c[16384]; };
static int leaf(struct big b) { return b.c[5]; }
__attribute__((noinline)) static int kept_out_of_line(struct big b) { return b.c[5] + b.c[16383]; }
__attribute__((noinline)) static int inlined_leaf(int n, struct big *p) {
  if (!n) return 0;
  int r = (n % 1000 == 0) ? leaf(*p) : 0;
  return r + inlined_leaf(n - 1, p) + 1;
}
__attribute__((noinline)) static int called_leaf(int n, struct big *p) {
  if (!n) return 0;
  int r = (n % 1000 == 0) ? kept_out_of_line(*p) : 0;
  return r + called_leaf(n - 1, p) + 1;
}
// Many arguments rather than one large one: more than fit the registers, on the rare path too.
__attribute__((noinline)) static long many(long a, long b, long c, long d, long e, long f, long g, long h, long i, long j, long k, long l, long m, long n, long o, long p,
                                           long q, long r, long s, long t, long u, long v, long w, long x, long y, long z, long a2, long b2, long c2, long d2, long e2, long f2,
                                           long g2, long h2, long i2, long j2, long k2, long l2, long m2, long n2) {
  return a + b + c + d + e + f + g + h + i + j + k + l + m + n + o + p + q + r + s + t + u + v + w + x + y + z + a2 + b2 + c2 + d2 + e2 + f2 + g2 + h2 + i2 + j2 + k2 + l2 + m2 + n2;
}
__attribute__((noinline)) static long with_many(int n) {
  if (!n) return 0;
  long r = (n % 1000 == 0) ? many(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, n) : 0;
  return r + with_many(n - 1) + 1;
}

int main(void) {
  static struct big b;
  b.c[5] = 1;
  b.c[16383] = 2;
  printf("%d %d %ld\n", inlined_leaf(20000, &b), called_leaf(20000, &b), with_many(20000));
  return 0;
}
