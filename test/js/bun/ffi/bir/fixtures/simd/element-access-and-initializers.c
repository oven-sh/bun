typedef int V __attribute__((vector_size(16)));
         typedef unsigned char B __attribute__((vector_size(16)));
         typedef short H __attribute__((vector_size(16)));
         typedef double D __attribute__((vector_size(16)));
         static const V table = {10, 20, 30, 40};
         static V zeros;
         V partly = {7};
         int third(V v) { return v[2]; }
         int pick(V v, int i) { return v[i]; }
         int pick_global(int i) { return table[i] + zeros[i] + partly[0] + partly[3]; }
         V set_lane(V v, int x) { v[1] = x; v[3] += 5; v[0]++; return v; }
         V set_at(V v, int i, int x) { v[i] = x; return v; }
         V build4(int a, int b) { V v = {a, 2, b}; return v; }
         V broadcast(int x) { return (V){x, x, x, x}; }
         V constant(void) { return (V){1, -2, 3, -4}; }
         int narrow(B b, H h) { return b[15] + h[7] + (signed char)b[0]; }
         double dsum(D d) { return d[0] + d[1]; }
         int size(void) { return sizeof(V) * 100 + _Alignof(V) + sizeof(table) / sizeof(table[0]); }
         int through_pointer(V *p) { V v = *p; p[1] = v + 1; (*p)[2] = 99; return p[1][3]; }
         typedef V U __attribute__((aligned(1)));
         int unaligned(char *bytes) { V v = *(U *)(bytes + 1); *(U *)(bytes + 3) = v; return v[0]; }
         V array_sum(void) { V a[3] = {{1, 1, 1, 1}, {2, 2, 2, 2}}; a[2] = a[0] + a[1]; return a[2] + table; }
         int from_rvalue(V a, V b) { return (a + b)[1] + (a * b)[3]; }

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
static unsigned char buffer2[32] __attribute__((aligned(16)));
int main(void) {
  printf("%d\n", (int)third((int __attribute__((vector_size(16))))(bun_test_bytes){5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0}));
  printf("%d\n", (int)pick((int __attribute__((vector_size(16))))(bun_test_bytes){5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0}, 0));
  printf("%d\n", (int)pick_global(0));
  printf("%d\n", (int)pick((int __attribute__((vector_size(16))))(bun_test_bytes){5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0}, 1));
  printf("%d\n", (int)pick_global(1));
  printf("%d\n", (int)pick((int __attribute__((vector_size(16))))(bun_test_bytes){5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0}, 2));
  printf("%d\n", (int)pick_global(2));
  printf("%d\n", (int)pick((int __attribute__((vector_size(16))))(bun_test_bytes){5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0}, 3));
  printf("%d\n", (int)pick_global(3));
  bun_test_show((bun_test_bytes)set_lane((int __attribute__((vector_size(16))))(bun_test_bytes){5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0}, -1));
  bun_test_show((bun_test_bytes)set_at((int __attribute__((vector_size(16))))(bun_test_bytes){5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0}, 2, 42));
  bun_test_show((bun_test_bytes)build4(9, 8));
  bun_test_show((bun_test_bytes)broadcast(-3));
  bun_test_show((bun_test_bytes)constant());
  printf("%d\n", (int)narrow((unsigned char __attribute__((vector_size(16))))(bun_test_bytes){255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 200}, (short __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 254, 255}));
  printf("%.17g\n", (double)dsum((double __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 0, 0, 0, 248, 63, 0, 0, 0, 0, 0, 0, 2, 64}));
  printf("%d\n", (int)size());
  bun_test_fill(buffer1, (const unsigned char[]){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 48);
  printf("%d\n", (int)through_pointer((void *)buffer1));
  bun_test_dump("buffer1", buffer1, 48);
  bun_test_fill(buffer2, (const unsigned char[]){0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31}, 32);
  printf("%d\n", (int)unaligned((void *)buffer2));
  bun_test_dump("buffer2", buffer2, 32);
  bun_test_show((bun_test_bytes)array_sum());
  printf("%d\n", (int)from_rvalue((int __attribute__((vector_size(16))))(bun_test_bytes){5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}));
  return 0;
}
