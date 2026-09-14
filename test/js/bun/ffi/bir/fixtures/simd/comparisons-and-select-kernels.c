typedef int V __attribute__((vector_size(16)));
         typedef float F __attribute__((vector_size(16)));
         V vmax(V a, V b) { return a > b ? a : b; }
         V clamp(V x, int lo, int hi) { V l = {lo, lo, lo, lo}; V h = {hi, hi, hi, hi}; x = x < l ? l : x; return x > h ? h : x; }
         F fabs4(F x) { return x < 0.0f ? -x : x; }
         void clamp_array(int *data, int n, int lo, int hi) {
             int i = 0;
             for (; i + 4 <= n; i += 4) *(V *)(data + i) = clamp(*(V *)(data + i), lo, hi);
             for (; i < n; i++) data[i] = data[i] < lo ? lo : data[i] > hi ? hi : data[i];
         }
         int count_greater(const int *data, int n, int limit) {
             V total = {0, 0, 0, 0};
             for (int i = 0; i + 4 <= n; i += 4) total -= *(const V *)(data + i) > limit;
             return total[0] + total[1] + total[2] + total[3];
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
int main(void) {
  bun_test_show((bun_test_bytes)vmax((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 251, 255, 255, 255, 9, 0, 0, 0, 0, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 0, 254, 255, 255, 255, 10, 0, 0, 0, 0, 0, 0, 0}));
  bun_test_show((bun_test_bytes)clamp((int __attribute__((vector_size(16))))(bun_test_bytes){206, 255, 255, 255, 5, 0, 0, 0, 50, 0, 0, 0, 10, 0, 0, 0}, -10, 10));
  bun_test_show((bun_test_bytes)fabs4((float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 192, 191, 0, 0, 0, 64, 0, 0, 0, 128, 0, 0, 0, 193}));
  bun_test_fill(buffer1, (const unsigned char[]){196, 255, 255, 255, 209, 255, 255, 255, 222, 255, 255, 255, 235, 255, 255, 255, 248, 255, 255, 255, 5, 0, 0, 0, 18, 0, 0, 0, 31, 0, 0, 0, 44, 0, 0, 0, 57, 0, 0, 0, 70, 0, 0, 0, 0, 0, 0, 0}, 48);
  clamp_array((void *)buffer1, 11, -20, 25);
  bun_test_dump("buffer1", buffer1, 48);
  bun_test_fill(buffer2, (const unsigned char[]){196, 255, 255, 255, 209, 255, 255, 255, 222, 255, 255, 255, 235, 255, 255, 255, 248, 255, 255, 255, 5, 0, 0, 0, 18, 0, 0, 0, 31, 0, 0, 0, 44, 0, 0, 0, 57, 0, 0, 0, 70, 0, 0, 0, 0, 0, 0, 0}, 48);
  printf("%d\n", (int)count_greater((void *)buffer2, 8, -10));
  return 0;
}
