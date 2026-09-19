typedef float F __attribute__((vector_size(16)));
         float dot(const float *a, const float *b, int n) {
             F acc = {0, 0, 0, 0};
             int i = 0;
             for (; i + 4 <= n; i += 4) acc += *(const F *)(a + i) * *(const F *)(b + i);
             float total = acc[0] + acc[1] + acc[2] + acc[3];
             for (; i < n; i++) total += a[i] * b[i];
             return total;
         }
         F mat_vec(const F columns[4], F v) {
             return columns[0] * v[0] + columns[1] * v[1] + columns[2] * v[2] + columns[3] * v[3];
         }
         F transform(const float *m, F v) { return mat_vec((const F *)m, v); }
         void saxpy(float a, const float *x, float *y, int n) {
             int i = 0;
             for (; i + 4 <= n; i += 4) *(F *)(y + i) = a * *(const F *)(x + i) + *(F *)(y + i);
             for (; i < n; i++) y[i] = a * x[i] + y[i];
         }

int printf(const char *, ...);
typedef unsigned char bun_test_bytes __attribute__((vector_size(16)));
static void bun_test_show(bun_test_bytes v) {
  for (int i = 0; i < 16; i++) printf(i ? " %02x" : "%02x", v[i]);
  printf("\n");
}
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[48] __attribute__((aligned(16)));
static unsigned char buffer2[48] __attribute__((aligned(16)));
static unsigned char buffer3[64] __attribute__((aligned(16)));
static unsigned char buffer4[32] __attribute__((aligned(16)));
static unsigned char buffer5[32] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){0, 0, 128, 191, 0, 0, 0, 191, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 128, 63, 0, 0, 192, 63, 0, 0, 0, 64, 0, 0, 32, 64, 0, 0, 64, 64, 0, 0, 96, 64, 0, 0, 0, 0, 0, 0, 0, 0}, 48);
  bun_test_fill(buffer2, (const unsigned char[]){0, 0, 64, 64, 0, 0, 0, 64, 0, 0, 128, 63, 0, 0, 0, 0, 0, 0, 128, 191, 0, 0, 0, 192, 0, 0, 64, 192, 0, 0, 128, 192, 0, 0, 160, 192, 0, 0, 192, 192, 0, 0, 0, 0, 0, 0, 0, 0}, 48);
  printf("%.9g\n", (double)dot((void *)buffer1, (void *)buffer2, 10));
  bun_test_fill(buffer3, (const unsigned char[]){0, 0, 0, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 0, 0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 128, 63}, 64);
  bun_test_show((bun_test_bytes)transform((void *)buffer3, (float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 63, 0, 0, 128, 63, 0, 0, 128, 63, 0, 0, 128, 63}));
  bun_test_fill(buffer4, (const unsigned char[]){0, 0, 0, 0, 0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 128, 64, 0, 0, 160, 64, 0, 0, 192, 64, 0, 0, 0, 0}, 32);
  bun_test_fill(buffer5, (const unsigned char[]){0, 0, 32, 65, 0, 0, 16, 65, 0, 0, 0, 65, 0, 0, 224, 64, 0, 0, 192, 64, 0, 0, 160, 64, 0, 0, 128, 64, 0, 0, 0, 0}, 32);
  saxpy(0x1.8000000000000p+0f, (void *)buffer4, (void *)buffer5, 7);
  bun_test_dump("buffer5", buffer5, 32);
  return 0;
}
