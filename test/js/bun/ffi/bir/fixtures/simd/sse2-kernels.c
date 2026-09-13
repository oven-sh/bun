#include <immintrin.h>
         #include <stddef.h>
         #if !defined(__SSE__) || !defined(__SSE2__) || !defined(__SSE4_1__) || defined(__SSE4_2__) || defined(__AVX__) || defined(__ARM_NEON)
         #error feature macros
         #endif
         /* memchr: compare 16 bytes to a splat, movemask, count trailing zeros. */
         const unsigned char *find_byte(const unsigned char *s, size_t n, unsigned char c) {
             __m128i needle = _mm_set1_epi8((char)c);
             size_t i = 0;
             for (; i + 16 <= n; i += 16) {
                 __m128i chunk = _mm_loadu_si128((const __m128i *)(s + i));
                 int mask = _mm_movemask_epi8(_mm_cmpeq_epi8(chunk, needle));
                 if (mask) return s + i + __builtin_ctz(mask);
             }
             for (; i < n; i++) if (s[i] == c) return s + i;
             return 0;
         }
         long find_index(const unsigned char *s, size_t n, unsigned char c) {
             const unsigned char *p = find_byte(s, n, c);
             return p ? p - s : -1;
         }
         /* Adler-32 style byte sum with widening through unpack. */
         unsigned sum_bytes(const unsigned char *s, size_t n) {
             __m128i zero = _mm_setzero_si128();
             __m128i total = zero;
             size_t i = 0;
             for (; i + 16 <= n; i += 16) {
                 __m128i chunk = _mm_loadu_si128((const __m128i *)(s + i));
                 __m128i lo = _mm_unpacklo_epi8(chunk, zero), hi = _mm_unpackhi_epi8(chunk, zero);
                 __m128i sum16 = _mm_add_epi16(lo, hi);
                 total = _mm_add_epi32(total, _mm_add_epi32(_mm_unpacklo_epi16(sum16, zero), _mm_unpackhi_epi16(sum16, zero)));
             }
             total = _mm_add_epi32(total, _mm_shuffle_epi32(total, _MM_SHUFFLE(1, 0, 3, 2)));
             total = _mm_add_epi32(total, _mm_shuffle_epi32(total, _MM_SHUFFLE(2, 3, 0, 1)));
             unsigned result = (unsigned)_mm_cvtsi128_si32(total);
             for (; i < n; i++) result += s[i];
             return result;
         }
         void gray(const unsigned char *rgba, unsigned char *out, int pixels) {
             __m128i weights = _mm_setr_epi16(77, 150, 29, 0, 77, 150, 29, 0);
             for (int i = 0; i + 4 <= pixels; i += 4) {
                 __m128i px = _mm_loadu_si128((const __m128i *)(rgba + 4 * i));
                 __m128i lo = _mm_mullo_epi16(_mm_cvtepu8_epi16(px), weights);
                 __m128i hi = _mm_mullo_epi16(_mm_cvtepu8_epi16(_mm_srli_si128(px, 8)), weights);
                 out[i + 0] = (_mm_extract_epi16(lo, 0) + _mm_extract_epi16(lo, 1) + _mm_extract_epi16(lo, 2)) >> 8;
                 out[i + 1] = (_mm_extract_epi16(lo, 4) + _mm_extract_epi16(lo, 5) + _mm_extract_epi16(lo, 6)) >> 8;
                 out[i + 2] = (_mm_extract_epi16(hi, 0) + _mm_extract_epi16(hi, 1) + _mm_extract_epi16(hi, 2)) >> 8;
                 out[i + 3] = (_mm_extract_epi16(hi, 4) + _mm_extract_epi16(hi, 5) + _mm_extract_epi16(hi, 6)) >> 8;
             }
         }
         float dot4(const float *a, const float *b) {
             __m128 p = _mm_mul_ps(_mm_loadu_ps(a), _mm_loadu_ps(b));
             p = _mm_add_ps(p, _mm_shuffle_ps(p, p, _MM_SHUFFLE(1, 0, 3, 2)));
             p = _mm_add_ps(p, _mm_shuffle_ps(p, p, _MM_SHUFFLE(2, 3, 0, 1)));
             return _mm_cvtss_f32(p);
         }
         int float_bits(float a, float b, float c, float d) {
             __m128 v = _mm_set_ps(d, c, b, a);
             __m128 clamped = _mm_min_ps(_mm_max_ps(v, _mm_set1_ps(-1.0f)), _mm_set1_ps(1.0f));
             int negative = _mm_movemask_ps(v);
             int saturated = _mm_movemask_ps(_mm_cmpneq_ps(v, clamped));
             __m128i rounded = _mm_cvttps_epi32(_mm_mul_ps(clamped, _mm_set1_ps(100.0f)));
             return negative * 1000000 + saturated * 10000 + _mm_cvtsi128_si32(rounded) + _mm_extract_epi32(rounded, 3);
         }
         int misc(int x) {
             __m128i v = _mm_set_epi32(4 * x, 3 * x, 2 * x, x);
             __m128i shifted = _mm_slli_epi32(v, 2);
             __m128i wide = _mm_srli_epi64(_mm_set1_epi64x(-1), 60);
             __m128i arithmetic = _mm_srai_epi16(_mm_set1_epi16(-256), 4);
             __m128i gone = _mm_slli_epi16(_mm_set1_epi16(1), 16);
             __m128i blended = _mm_blendv_epi8(v, shifted, _mm_cmpgt_epi32(v, _mm_set1_epi32(2 * x)));
             int zero = _mm_testz_si128(_mm_and_si128(v, _mm_setzero_si128()), v);
             __m128d d = _mm_cvtepi32_pd(v);
             d = _mm_add_pd(_mm_mul_pd(d, _mm_set1_pd(0.5)), _mm_sqrt_pd(_mm_set_pd(16.0, 9.0)));
             return _mm_extract_epi32(blended, 0) + _mm_extract_epi32(blended, 3) * 10
                 + (int)_mm_cvtsi128_si64(wide) * 1000 + (short)_mm_extract_epi16(arithmetic, 3) * 10000
                 + _mm_extract_epi16(gone, 0) + zero * 100000
                 + _mm_movemask_pd(_mm_cmplt_pd(d, _mm_set1_pd(4.2))) * 1000000 + (int)_mm_cvtsd_f64(d);
         }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[80] __attribute__((aligned(16)));
static unsigned char buffer2[104] __attribute__((aligned(16)));
static unsigned char buffer3[32] __attribute__((aligned(16)));
static unsigned char buffer4[8] __attribute__((aligned(16)));
static unsigned char buffer5[16] __attribute__((aligned(16)));
static unsigned char buffer6[16] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 97, 98, 99, 100, 101, 102, 103, 33, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 97, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 80);
  printf("%lld\n", (long long)find_index((void *)buffer1, 70LL, 33));
  printf("%lld\n", (long long)find_index((void *)buffer1, 70LL, 99));
  printf("%lld\n", (long long)find_index((void *)buffer1, 50LL, 33));
  printf("%lld\n", (long long)find_index((void *)buffer1, 70LL, 114));
  printf("%lld\n", (long long)find_index((void *)buffer1, 17LL, 114));
  bun_test_fill(buffer2, (const unsigned char[]){200, 237, 18, 55, 92, 129, 166, 203, 240, 21, 58, 95, 132, 169, 206, 243, 24, 61, 98, 135, 172, 209, 246, 27, 64, 101, 138, 175, 212, 249, 30, 67, 104, 141, 178, 215, 252, 33, 70, 107, 144, 181, 218, 255, 36, 73, 110, 147, 184, 221, 2, 39, 76, 113, 150, 187, 224, 5, 42, 79, 116, 153, 190, 227, 8, 45, 82, 119, 156, 193, 230, 11, 48, 85, 122, 159, 196, 233, 14, 51, 88, 125, 162, 199, 236, 17, 54, 91, 128, 165, 202, 239, 20, 57, 94, 131, 168, 205, 242, 23, 0, 0, 0, 0}, 104);
  printf("%d\n", (int)sum_bytes((void *)buffer2, 100LL));
  bun_test_fill(buffer3, (const unsigned char[]){7, 36, 65, 94, 123, 152, 181, 210, 239, 12, 41, 70, 99, 128, 157, 186, 215, 244, 17, 46, 75, 104, 133, 162, 191, 220, 249, 22, 51, 80, 109, 138}, 32);
  for (int i = 0; i < 8; i++) buffer4[i] = 0;
  gray((void *)buffer3, (void *)buffer4, 8);
  bun_test_dump("buffer4", buffer4, 8);
  bun_test_fill(buffer5, (const unsigned char[]){0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 128, 64}, 16);
  bun_test_fill(buffer6, (const unsigned char[]){0, 0, 0, 63, 0, 0, 128, 62, 0, 0, 0, 64, 0, 0, 128, 191}, 16);
  printf("%.9g\n", (double)dot4((void *)buffer5, (void *)buffer6));
  printf("%d\n", (int)float_bits(0x1.0000000000000p-2f, -0x1.8000000000000p+1f, 0x1.c000000000000p+2f, -0x1.0000000000000p-1f));
  printf("%d\n", (int)misc(3));
  return 0;
}
