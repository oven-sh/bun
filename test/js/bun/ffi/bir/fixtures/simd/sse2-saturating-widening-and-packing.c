#include <immintrin.h>
void run(const __m128i *a, const __m128i *b, __m128i *out) {
  out[0] = _mm_adds_epu8(*a, *b);
  out[1] = _mm_subs_epu8(*a, *b);
  out[2] = _mm_adds_epi8(*a, *b);
  out[3] = _mm_subs_epi8(*a, *b);
  out[4] = _mm_adds_epu16(*a, *b);
  out[5] = _mm_subs_epu16(*a, *b);
  out[6] = _mm_adds_epi16(*a, *b);
  out[7] = _mm_subs_epi16(*a, *b);
  out[8] = _mm_avg_epu8(*a, *b);
  out[9] = _mm_avg_epu16(*a, *b);
  out[10] = _mm_mul_epu32(*a, *b);
  out[11] = _mm_madd_epi16(*a, *b);
  out[12] = _mm_mulhi_epi16(*a, *b);
  out[13] = _mm_mulhi_epu16(*a, *b);
  out[14] = _mm_sad_epu8(*a, *b);
  out[15] = _mm_packs_epi16(*a, *b);
  out[16] = _mm_packus_epi16(*a, *b);
  out[17] = _mm_packs_epi32(*a, *b);
  out[18] = _mm_min_epi32(*a, *b);
  out[19] = _mm_max_epu16(*a, *b);
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
static unsigned char buffer3[320] __attribute__((aligned(16)));
static unsigned char buffer4[16] __attribute__((aligned(16)));
static unsigned char buffer5[16] __attribute__((aligned(16)));
static unsigned char buffer6[16] __attribute__((aligned(16)));
static unsigned char buffer7[16] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){0, 1, 127, 128, 255, 200, 100, 50, 128, 127, 255, 1, 16, 240, 85, 170}, 16);
  bun_test_fill(buffer2, (const unsigned char[]){255, 255, 1, 128, 255, 100, 200, 50, 128, 1, 2, 255, 240, 16, 170, 85}, 16);
  for (int i = 0; i < 320; i++) buffer3[i] = 0;
  run((void *)buffer1, (void *)buffer2, (void *)buffer3);
  bun_test_dump("buffer3", buffer3, 320);
  bun_test_fill(buffer4, (const unsigned char[]){11, 48, 85, 122, 159, 196, 233, 14, 51, 88, 125, 162, 199, 236, 17, 54}, 16);
  bun_test_fill(buffer5, (const unsigned char[]){200, 35, 126, 217, 52, 143, 234, 69, 160, 251, 86, 177, 12, 103, 194, 29}, 16);
  for (int i = 0; i < 320; i++) buffer3[i] = 0;
  run((void *)buffer4, (void *)buffer5, (void *)buffer3);
  bun_test_dump("buffer3", buffer3, 320);
  bun_test_fill(buffer6, (const unsigned char[]){255, 127, 0, 128, 255, 255, 1, 0, 255, 127, 255, 127, 0, 128, 0, 128}, 16);
  bun_test_fill(buffer7, (const unsigned char[]){255, 127, 0, 128, 1, 0, 255, 255, 0, 128, 255, 127, 0, 128, 255, 127}, 16);
  for (int i = 0; i < 320; i++) buffer3[i] = 0;
  run((void *)buffer6, (void *)buffer7, (void *)buffer3);
  bun_test_dump("buffer3", buffer3, 320);
  return 0;
}
