typedef unsigned char B __attribute__((vector_size(16)));
         typedef unsigned short H __attribute__((vector_size(16)));
         void gray4(const unsigned char *rgba, unsigned char *out) {
             B px = *(const B *)rgba;
             B zero = {0};
             H lo = (H)__builtin_shufflevector(px, zero, 0, 16, 1, 16, 2, 16, 3, 16, 4, 16, 5, 16, 6, 16, 7, 16);
             H hi = (H)__builtin_shufflevector(px, zero, 8, 16, 9, 16, 10, 16, 11, 16, 12, 16, 13, 16, 14, 16, 15, 16);
             H weights = {77, 150, 29, 0, 77, 150, 29, 0};
             lo *= weights;
             hi *= weights;
             out[0] = (lo[0] + lo[1] + lo[2]) >> 8;
             out[1] = (lo[4] + lo[5] + lo[6]) >> 8;
             out[2] = (hi[0] + hi[1] + hi[2]) >> 8;
             out[3] = (hi[4] + hi[5] + hi[6]) >> 8;
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
static unsigned char buffer2[8] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){255, 255, 255, 255, 0, 0, 0, 9, 200, 100, 50, 0, 10, 250, 30, 77}, 16);
  for (int i = 0; i < 8; i++) buffer2[i] = 0;
  gray4((void *)buffer1, (void *)buffer2);
  bun_test_dump("buffer2", buffer2, 8);
  return 0;
}
