#include <smmintrin.h>
         #include <tmmintrin.h>
         static short out16[8]; static int out32[4]; static long long out64[2]; static float outf[4]; static double outd[2];
         static unsigned char bytes[16] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
         static void store16(__m128i v) { _mm_storeu_si128((__m128i *)out16, v); }
         int shuffles(int which, int lane) {
             __m128i v = _mm_setr_epi16(0, 1, 2, 3, 4, 5, 6, 7);
             if (which == 0) store16(_mm_shufflelo_epi16(v, _MM_SHUFFLE(0, 1, 2, 3)));
             if (which == 1) store16(_mm_shufflehi_epi16(v, _MM_SHUFFLE(0, 1, 2, 3)));
             if (which == 2) store16(_mm_blend_epi16(v, _mm_set1_epi16(9), 0xa5));
             if (which == 3) store16(_mm_sll_epi16(v, _mm_cvtsi32_si128(2)));
             if (which == 4) store16(_mm_sra_epi16(_mm_set1_epi16(-64), _mm_cvtsi32_si128(99)));
             if (which == 5) store16(_mm_mulhrs_epi16(_mm_setr_epi16(16384, -16384, 32767, -32768, 1, 100, 12345, -1), _mm_setr_epi16(16384, 16384, 32767, -32768, 1, 200, 23456, -1)));
             if (which == 6) store16(_mm_hsubs_epi16(_mm_setr_epi16(10, 3, -32768, 1, 5, 5, 0, -7), v));
             return out16[lane];
         }
         int widen(int which, int lane) {
             __m128i v = _mm_setr_epi8(-1, 2, -3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
             if (which == 0) _mm_storeu_si128((__m128i *)out32, _mm_cvtepi8_epi32(v));
             if (which == 1) _mm_storeu_si128((__m128i *)out32, _mm_cvtepu8_epi32(v));
             if (which == 2) _mm_storeu_si128((__m128i *)out32, _mm_srl_epi32(_mm_set1_epi32(-1), _mm_cvtsi32_si128(28)));
             if (which == 3) _mm_storeu_si128((__m128i *)out32, _mm_loadu_si32(bytes + 1));
             return out32[lane];
         }
         long long wide(int which, int lane) {
             if (which == 0) _mm_storeu_si128((__m128i *)out64, _mm_mul_epi32(_mm_setr_epi32(-3, 99, 100000, 99), _mm_setr_epi32(7, 99, 100000, 99)));
             if (which == 1) _mm_storeu_si128((__m128i *)out64, _mm_cmpgt_epi64(_mm_set_epi64x(5, -1), _mm_set_epi64x(4, 0)));
             if (which == 2) _mm_storeu_si128((__m128i *)out64, _mm_cvtepi8_epi64(_mm_setr_epi8(-2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)));
             if (which == 3) _mm_storeu_si128((__m128i *)out64, _mm_move_epi64(_mm_set_epi64x(7, 8)));
             if (which == 4) _mm_storeu_si128((__m128i *)out64, _mm_loadu_si64(bytes + 3));
             return out64[lane];
         }
         float scalars(int which, int lane) {
             __m128 a = _mm_setr_ps(1.5f, 2, 3, 4), b = _mm_setr_ps(0.25f, 20, 30, 40);
             if (which == 0) _mm_storeu_ps(outf, _mm_add_ss(a, b));
             if (which == 1) _mm_storeu_ps(outf, _mm_move_ss(a, b));
             if (which == 2) _mm_storeu_ps(outf, _mm_blend_ps(a, b, 0x6));
             if (which == 3) _mm_storeu_ps(outf, _mm_cvtsi32_ss(a, 7));
             if (which == 4) _mm_storer_ps(outf, a);
             if (which == 5) _mm_storeu_ps(outf, _mm_min_ss(a, b));
             return outf[lane];
         }
         double doubles(int which, int lane) {
             __m128d a = _mm_setr_pd(1.5, 2), b = _mm_setr_pd(0.25, 20);
             if (which == 0) _mm_storeu_pd(outd, _mm_sub_sd(a, b));
             if (which == 1) _mm_storeu_pd(outd, _mm_loadh_pd(a, &outd[1]));
             if (which == 2) _mm_storeu_pd(outd, _mm_cvtss_sd(a, _mm_set_ss(9.5f)));
             if (which == 3) _mm_storeu_pd(outd, _mm_sqrt_sd(a, _mm_set_sd(16)));
             return outd[lane];
         }
         int tests(void) {
             __m128i ones = _mm_set1_epi32(-1), some = _mm_setr_epi32(1, 0, 0, 0);
             return _mm_test_all_ones(ones) + _mm_test_all_ones(some) * 2 + _mm_test_all_zeros(some, _mm_setr_epi32(2, 0, 0, 0)) * 4
                  + _mm_testc_si128(ones, some) * 8 + _mm_testnzc_si128(some, ones) * 16 + _mm_comilt_ss(_mm_set_ss(1), _mm_set_ss(2)) * 32
                  + _mm_ucomieq_sd(_mm_set_sd(1), _mm_set_sd(1)) * 64 + (_mm_movemask_ps(_mm_cmpnlt_ps(_mm_setr_ps(1, 5, 3, 0), _mm_setr_ps(2, 2, 3, __builtin_nanf("")))) << 8)
                  + (_mm_extract_ps(_mm_setr_ps(0, 1.0f, 0, 0), 1) == 0x3f800000) * 128;
         }
         int masked(int lane) {
             char target[16];
             for (int i = 0; i < 16; i++) target[i] = 100;
             _mm_maskmoveu_si128(_mm_loadu_si128((const __m128i *)bytes), _mm_setr_epi8(-1, 0, 0, -128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 127), target);
             _mm_sfence(); _mm_lfence(); _mm_mfence(); _mm_pause(); _mm_prefetch(target, _MM_HINT_T0);
             return target[lane];
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)shuffles(0, 0));
  printf("%d\n", (int)shuffles(0, 1));
  printf("%d\n", (int)shuffles(0, 2));
  printf("%d\n", (int)shuffles(0, 3));
  printf("%d\n", (int)shuffles(0, 4));
  printf("%d\n", (int)shuffles(0, 5));
  printf("%d\n", (int)shuffles(0, 6));
  printf("%d\n", (int)shuffles(0, 7));
  printf("%d\n", (int)shuffles(1, 0));
  printf("%d\n", (int)shuffles(1, 1));
  printf("%d\n", (int)shuffles(1, 2));
  printf("%d\n", (int)shuffles(1, 3));
  printf("%d\n", (int)shuffles(1, 4));
  printf("%d\n", (int)shuffles(1, 5));
  printf("%d\n", (int)shuffles(1, 6));
  printf("%d\n", (int)shuffles(1, 7));
  printf("%d\n", (int)shuffles(2, 0));
  printf("%d\n", (int)shuffles(2, 1));
  printf("%d\n", (int)shuffles(2, 2));
  printf("%d\n", (int)shuffles(2, 3));
  printf("%d\n", (int)shuffles(2, 4));
  printf("%d\n", (int)shuffles(2, 5));
  printf("%d\n", (int)shuffles(2, 6));
  printf("%d\n", (int)shuffles(2, 7));
  printf("%d\n", (int)shuffles(3, 0));
  printf("%d\n", (int)shuffles(3, 1));
  printf("%d\n", (int)shuffles(3, 2));
  printf("%d\n", (int)shuffles(3, 3));
  printf("%d\n", (int)shuffles(3, 4));
  printf("%d\n", (int)shuffles(3, 5));
  printf("%d\n", (int)shuffles(3, 6));
  printf("%d\n", (int)shuffles(3, 7));
  printf("%d\n", (int)shuffles(4, 0));
  printf("%d\n", (int)shuffles(4, 1));
  printf("%d\n", (int)shuffles(4, 2));
  printf("%d\n", (int)shuffles(4, 3));
  printf("%d\n", (int)shuffles(4, 4));
  printf("%d\n", (int)shuffles(4, 5));
  printf("%d\n", (int)shuffles(4, 6));
  printf("%d\n", (int)shuffles(4, 7));
  printf("%d\n", (int)shuffles(5, 0));
  printf("%d\n", (int)shuffles(5, 1));
  printf("%d\n", (int)shuffles(5, 2));
  printf("%d\n", (int)shuffles(5, 3));
  printf("%d\n", (int)shuffles(5, 4));
  printf("%d\n", (int)shuffles(5, 5));
  printf("%d\n", (int)shuffles(5, 6));
  printf("%d\n", (int)shuffles(5, 7));
  printf("%d\n", (int)shuffles(6, 0));
  printf("%d\n", (int)shuffles(6, 1));
  printf("%d\n", (int)shuffles(6, 2));
  printf("%d\n", (int)shuffles(6, 3));
  printf("%d\n", (int)shuffles(6, 4));
  printf("%d\n", (int)shuffles(6, 5));
  printf("%d\n", (int)shuffles(6, 6));
  printf("%d\n", (int)shuffles(6, 7));
  printf("%d\n", (int)widen(0, 0));
  printf("%d\n", (int)widen(0, 1));
  printf("%d\n", (int)widen(0, 2));
  printf("%d\n", (int)widen(0, 3));
  printf("%d\n", (int)widen(1, 0));
  printf("%d\n", (int)widen(1, 1));
  printf("%d\n", (int)widen(1, 2));
  printf("%d\n", (int)widen(1, 3));
  printf("%d\n", (int)widen(2, 0));
  printf("%d\n", (int)widen(2, 1));
  printf("%d\n", (int)widen(2, 2));
  printf("%d\n", (int)widen(2, 3));
  printf("%d\n", (int)widen(3, 0));
  printf("%d\n", (int)widen(3, 1));
  printf("%d\n", (int)widen(3, 2));
  printf("%d\n", (int)widen(3, 3));
  printf("%lld\n", (long long)wide(0, 0));
  printf("%lld\n", (long long)wide(0, 1));
  printf("%lld\n", (long long)wide(1, 0));
  printf("%lld\n", (long long)wide(1, 1));
  printf("%lld\n", (long long)wide(2, 0));
  printf("%lld\n", (long long)wide(2, 1));
  printf("%lld\n", (long long)wide(3, 0));
  printf("%lld\n", (long long)wide(3, 1));
  printf("%lld\n", (long long)wide(4, 0));
  printf("%lld\n", (long long)wide(4, 1));
  printf("%.9g\n", (double)scalars(0, 0));
  printf("%.9g\n", (double)scalars(0, 1));
  printf("%.9g\n", (double)scalars(0, 2));
  printf("%.9g\n", (double)scalars(0, 3));
  printf("%.9g\n", (double)scalars(1, 0));
  printf("%.9g\n", (double)scalars(1, 1));
  printf("%.9g\n", (double)scalars(1, 2));
  printf("%.9g\n", (double)scalars(1, 3));
  printf("%.9g\n", (double)scalars(2, 0));
  printf("%.9g\n", (double)scalars(2, 1));
  printf("%.9g\n", (double)scalars(2, 2));
  printf("%.9g\n", (double)scalars(2, 3));
  printf("%.9g\n", (double)scalars(3, 0));
  printf("%.9g\n", (double)scalars(3, 1));
  printf("%.9g\n", (double)scalars(3, 2));
  printf("%.9g\n", (double)scalars(3, 3));
  printf("%.9g\n", (double)scalars(4, 0));
  printf("%.9g\n", (double)scalars(4, 1));
  printf("%.9g\n", (double)scalars(4, 2));
  printf("%.9g\n", (double)scalars(4, 3));
  printf("%.9g\n", (double)scalars(5, 0));
  printf("%.9g\n", (double)scalars(5, 1));
  printf("%.9g\n", (double)scalars(5, 2));
  printf("%.9g\n", (double)scalars(5, 3));
  printf("%.17g\n", (double)doubles(0, 0));
  printf("%.17g\n", (double)doubles(0, 1));
  printf("%.17g\n", (double)doubles(1, 0));
  printf("%.17g\n", (double)doubles(1, 1));
  printf("%.17g\n", (double)doubles(2, 0));
  printf("%.17g\n", (double)doubles(2, 1));
  printf("%.17g\n", (double)doubles(3, 0));
  printf("%.17g\n", (double)doubles(3, 1));
  printf("%d\n", (int)tests());
  printf("%d\n", (int)masked(0));
  printf("%d\n", (int)masked(1));
  printf("%d\n", (int)masked(2));
  printf("%d\n", (int)masked(3));
  printf("%d\n", (int)masked(4));
  printf("%d\n", (int)masked(5));
  printf("%d\n", (int)masked(6));
  printf("%d\n", (int)masked(7));
  printf("%d\n", (int)masked(8));
  printf("%d\n", (int)masked(9));
  printf("%d\n", (int)masked(10));
  printf("%d\n", (int)masked(11));
  printf("%d\n", (int)masked(12));
  printf("%d\n", (int)masked(13));
  printf("%d\n", (int)masked(14));
  printf("%d\n", (int)masked(15));
  return 0;
}
