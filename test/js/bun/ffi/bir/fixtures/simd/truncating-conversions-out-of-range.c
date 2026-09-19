// The truncating vector conversions of <emmintrin.h> give what the instructions give for a value that does not fit in
// the result, or is not a number: the "integer indefinite" value, 0x80000000.
// Code that detects overflow by comparing with that value depends on it. (What a plain C cast, or
// __builtin_convertvector, gives for such a value is not defined, and is not printed.)
#include <emmintrin.h>
#include <math.h>
#include <stdio.h>

static void show(const char *what, __m128i v) {
  int lanes[4];
  _mm_storeu_si128((__m128i *)lanes, v);
  printf("%s: %08x %08x %08x %08x\n", what, (unsigned)lanes[0], (unsigned)lanes[1], (unsigned)lanes[2], (unsigned)lanes[3]);
}

int main(void) {
  volatile float f[][4] = {
    { 3e9f, NAN, -2.5f, 1.5f }, { INFINITY, -INFINITY, 2147483648.0f, -2147483648.0f }, { 2147483520.0f, -2147483904.0f, 0.99f, -0.99f }, { -3e9f, 1e30f, -0.0f, 100.99f },
  };
  for (int i = 0; i < 4; i++) show("cvttps_epi32", _mm_cvttps_epi32(_mm_setr_ps(f[i][0], f[i][1], f[i][2], f[i][3])));
  volatile double d[][2] = { { 3e9, NAN }, { -2.5, 1.5 }, { INFINITY, -INFINITY }, { 2147483647.9, -2147483648.9 }, { 2147483648.0, -2147483649.0 }, { -0.0, 1e300 } };
  for (int i = 0; i < 6; i++) show("cvttpd_epi32", _mm_cvttpd_epi32(_mm_setr_pd(d[i][0], d[i][1])));
  // In range, the intrinsic and the C conversion agree.
  __m128 in_range = _mm_setr_ps(-7.9f, 7.9f, 1e9f, -1e9f);
  show("in range", _mm_cvttps_epi32(in_range));
  return 0;
}
