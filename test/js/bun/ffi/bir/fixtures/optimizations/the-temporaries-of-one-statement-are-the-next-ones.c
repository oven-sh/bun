// What one statement keeps in the frame for its temporaries (a structure a call returns, a `long double`, a 128-bit
// product) is free for the next statement. Sixty such statements in a row in a function that then calls itself
// 3,000 deep: that fits the stack when each level has the room of one statement's temporaries, as it does for GCC and
// Clang without optimizing, and not when it has all of them at once (3 KB a level where it is 700 bytes).
#include <stdio.h>

struct big { long long a[4]; };
__attribute__((noinline)) static struct big make(long long n) { struct big b = { { n, n + 1, n + 2, n + 3 } }; return b; }
__attribute__((noinline)) static long double widen(long long n) { return (long double)n + 0.5L; }

#define ONE(k) s += make(n).a[k & 3];
#define FOUR(k) ONE(k) ONE(k + 1) ONE(k + 2) ONE(k + 3)
#define SIXTEEN(k) FOUR(k) FOUR(k + 4) FOUR(k + 8) FOUR(k + 12)
#define LONG_ONE(k) s += (long long)(widen(n) * (long double)(k + 1));
#define WIDE_ONE(k) s += (long long)(((__int128)n * (k + 1) * 0x100000001LL) >> 32);

__attribute__((noinline)) static long long descend(long long n, long long depth) {
  long long s = 0;
  SIXTEEN(0) SIXTEEN(16) SIXTEEN(32) FOUR(48) FOUR(52) FOUR(56)
  LONG_ONE(0) LONG_ONE(1) LONG_ONE(2) LONG_ONE(3) LONG_ONE(4) LONG_ONE(5) LONG_ONE(6) LONG_ONE(7)
  WIDE_ONE(0) WIDE_ONE(1) WIDE_ONE(2) WIDE_ONE(3)
  // (A comma expression of them is as many statements.)
  s += make(n).a[0], s += make(n).a[1], s += make(n).a[2], s += make(n).a[3];
  if (depth > 0) s += descend(n + 1, depth - 1) & 0xffff;
  return s;
}

// A statement expression whose value is one of the temporaries keeps it for as long as the statement it is in.
__attribute__((noinline)) static long long kept(long long n) {
  long long first = ({ struct big b = make(n); make(n + 1); b; }).a[2] + ({ make(n + 2); }).a[3];
  return first;
}

int main(void) {
  printf("%lld %lld\n", descend(1, 0), descend(1, 3000));
  printf("%lld\n", kept(10));
  return 0;
}
