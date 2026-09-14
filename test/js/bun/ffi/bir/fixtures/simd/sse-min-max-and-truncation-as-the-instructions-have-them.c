// The SSE minimum, maximum and truncating conversions are defined by what the instructions do in the corners: MINPS and
// MAXPS give the second operand when the two are unordered or equal (a NaN on either side, zeros of different signs), and
// CVTTPS2DQ and CVTTPD2DQ give 0x80000000 for a NaN and for anything that does not fit.
#include <emmintrin.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static void show_ps(const char *what, __m128 v) {
  uint32_t lanes[4];
  memcpy(lanes, &v, sizeof lanes);
  printf("%s: %08x %08x %08x %08x\n", what, lanes[0], lanes[1], lanes[2], lanes[3]);
}
static void show_pd(const char *what, __m128d v) {
  uint64_t lanes[2];
  memcpy(lanes, &v, sizeof lanes);
  printf("%s: %016llx %016llx\n", what, (unsigned long long)lanes[0], (unsigned long long)lanes[1]);
}
static void show_epi32(const char *what, __m128i v) {
  uint32_t lanes[4];
  memcpy(lanes, &v, sizeof lanes);
  printf("%s: %08x %08x %08x %08x\n", what, lanes[0], lanes[1], lanes[2], lanes[3]);
}

int main(void) {
  volatile float zero = 0.0f;
  volatile double dzero = 0.0;
  float nan = zero / zero, inf = 1.0f / zero;
  double dnan = dzero / dzero, dinf = 1.0 / dzero;
  // The NaNs here are made positive so that their bits are the same wherever they came from.
  nan = __builtin_copysignf(nan, 1.0f);
  dnan = __builtin_copysign(dnan, 1.0);

  __m128 a = _mm_setr_ps(3e9f, nan, -0.0f, 1.5f), b = _mm_setr_ps(-3e9f, 2.0f, 0.0f, nan);
  show_ps("min_ps(a, b)", _mm_min_ps(a, b));
  show_ps("min_ps(b, a)", _mm_min_ps(b, a));
  show_ps("max_ps(a, b)", _mm_max_ps(a, b));
  show_ps("max_ps(b, a)", _mm_max_ps(b, a));
  show_ps("min_ss(a, b)", _mm_min_ss(a, b));
  show_ps("max_ss(b, a)", _mm_max_ss(b, a));
  __m128 zeros_a = _mm_setr_ps(0.0f, -0.0f, nan, 7.0f), zeros_b = _mm_setr_ps(-0.0f, 0.0f, nan, 7.0f);
  show_ps("min_ps(zeros)", _mm_min_ps(zeros_a, zeros_b));
  show_ps("max_ps(zeros)", _mm_max_ps(zeros_a, zeros_b));
  show_ps("min_ss(nan, 1)", _mm_min_ss(_mm_set_ss(nan), _mm_set_ss(1.0f)));
  show_ps("min_ss(1, nan)", _mm_min_ss(_mm_set_ss(1.0f), _mm_set_ss(nan)));
  show_ps("max_ss(-0, 0)", _mm_max_ss(_mm_set_ss(-0.0f), _mm_set_ss(0.0f)));
  show_ps("max_ss(0, -0)", _mm_max_ss(_mm_set_ss(0.0f), _mm_set_ss(-0.0f)));

  __m128d c = _mm_setr_pd(dnan, -0.0), d = _mm_setr_pd(2.0, 0.0);
  show_pd("min_pd(c, d)", _mm_min_pd(c, d));
  show_pd("min_pd(d, c)", _mm_min_pd(d, c));
  show_pd("max_pd(c, d)", _mm_max_pd(c, d));
  show_pd("max_pd(d, c)", _mm_max_pd(d, c));
  show_pd("min_sd(c, d)", _mm_min_sd(c, d));
  show_pd("max_sd(d, c)", _mm_max_sd(d, c));
  show_pd("min_pd(1e300, -inf)", _mm_min_pd(_mm_setr_pd(1e300, 5.0), _mm_setr_pd(-dinf, dinf)));

  show_epi32("cvttps(3e9, nan, -2.5, 1.5)", _mm_cvttps_epi32(_mm_setr_ps(3e9f, nan, -2.5f, 1.5f)));
  show_epi32("cvttps(-3e9, inf, -inf, 2147483520)", _mm_cvttps_epi32(_mm_setr_ps(-3e9f, inf, -inf, 2147483520.0f)));
  show_epi32("cvttps(2^31, -2^31, -2^31 - 256, 0.99)", _mm_cvttps_epi32(_mm_setr_ps(2147483648.0f, -2147483648.0f, -2147483904.0f, 0.99f)));
  show_epi32("cvttpd(nan, 3e9)", _mm_cvttpd_epi32(_mm_setr_pd(dnan, 3e9)));
  show_epi32("cvttpd(-2.5, 2147483647.5)", _mm_cvttpd_epi32(_mm_setr_pd(-2.5, 2147483647.5)));
  show_epi32("cvttpd(2^31, -2^31 - 0.5)", _mm_cvttpd_epi32(_mm_setr_pd(2147483648.0, -2147483648.5)));
  show_epi32("cvttpd(-inf, -2^31 - 1)", _mm_cvttpd_epi32(_mm_setr_pd(-dinf, -2147483649.0)));

  // The scalar forms. (Through volatile objects: of constants GCC and Clang make what they like.)
  volatile float singles[] = { 1.99f, -1.99f, 3e9f, -3e9f, nan, inf, -inf, 2147483520.0f, -2147483648.0f, 9.3e18f, -9.3e18f, 9223371487098961920.0f };
  for (unsigned i = 0; i < sizeof singles / sizeof singles[0]; i++)
    printf("cvttss(%g): %d %lld\n", (double)singles[i], _mm_cvttss_si32(_mm_set_ss(singles[i])), _mm_cvttss_si64(_mm_set_ss(singles[i])));
  volatile double doubles[] = { 1.99, -1.99, 3e9, -3e9, dnan, dinf, -dinf, 2147483647.5, -2147483648.5, -2147483649.0, 9.3e18, -9.3e18, 9223372036854774784.0 };
  for (unsigned i = 0; i < sizeof doubles / sizeof doubles[0]; i++)
    printf("cvttsd(%g): %d %lld\n", doubles[i], _mm_cvttsd_si32(_mm_set_sd(doubles[i])), _mm_cvttsd_si64(_mm_set_sd(doubles[i])));
  _mm_pause();
  return 0;
}
