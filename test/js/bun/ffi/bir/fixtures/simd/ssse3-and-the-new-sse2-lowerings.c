#include <immintrin.h>
         #ifndef __SSSE3__
         #error SSSE3
         #endif
         void run(const __m128i *a, const __m128i *b, __m128i *out) {
  out[0] = _mm_shuffle_epi8(*a, *b);
  out[1] = _mm_abs_epi8(*a);
  out[2] = _mm_abs_epi16(*a);
  out[3] = _mm_abs_epi32(*a);
  out[4] = _mm_hadd_epi16(*a, *b);
  out[5] = _mm_hadd_epi32(*a, *b);
  out[6] = _mm_hsub_epi16(*a, *b);
  out[7] = _mm_hadds_epi16(*a, *b);
  out[8] = _mm_sign_epi8(*a, *b);
  out[9] = _mm_sign_epi16(*a, *b);
  out[10] = _mm_sign_epi32(*a, *b);
  out[11] = _mm_maddubs_epi16(*a, *b);
  out[12] = _mm_packus_epi32(*a, *b);
  out[13] = _mm_alignr_epi8(*a, *b, 0); out[14] = _mm_alignr_epi8(*a, *b, 5); out[15] = _mm_alignr_epi8(*a, *b, 16);
           out[16] = _mm_alignr_epi8(*a, *b, 21); out[17] = _mm_alignr_epi8(*a, *b, 40);
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
static unsigned char buffer1[16] __attribute__((aligned(16)));
static unsigned char buffer2[16] __attribute__((aligned(16)));
static unsigned char buffer3[288] __attribute__((aligned(16)));
static unsigned char buffer4[16] __attribute__((aligned(16)));
static unsigned char buffer5[16] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){3, 32, 61, 90, 119, 148, 177, 206, 235, 8, 37, 66, 95, 124, 153, 182}, 16);
  bun_test_fill(buffer2, (const unsigned char[]){0, 15, 128, 7, 143, 3, 16, 127, 1, 2, 255, 4, 16, 9, 8, 0}, 16);
  for (int i = 0; i < 288; i++) buffer3[i] = 0;
  run((void *)buffer1, (void *)buffer2, (void *)buffer3);
  bun_test_dump("buffer3", buffer3, 288);
  bun_test_fill(buffer4, (const unsigned char[]){128, 127, 255, 0, 1, 254, 64, 192, 128, 0, 255, 127, 18, 52, 86, 120}, 16);
  bun_test_fill(buffer5, (const unsigned char[]){255, 1, 0, 128, 127, 129, 0, 0, 255, 255, 1, 0, 0, 128, 156, 100}, 16);
  for (int i = 0; i < 288; i++) buffer3[i] = 0;
  run((void *)buffer4, (void *)buffer5, (void *)buffer3);
  bun_test_dump("buffer3", buffer3, 288);
  return 0;
}
