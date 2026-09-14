typedef unsigned short u16; typedef unsigned char u8;
         void stores(u16 *p, u8 *q, int x, long y) { *p = (u16)x; *q = (u8)y; p[1] = x; (*q)++; q[1] += 3; p[2] -= x; }
         int chain(u8 *q, int x) { int kept = (*q = x); return kept + (q[1] += 1) + q[2]++; }
         _Bool flags(_Bool *b, int x) { *b = x; return *b; }
         int branches(int a, long b, double c) { if (a) return 1; if (!b) return 2; if (c) return 3; while (a & 4) a++; return a ? 5 : 6; }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[8] __attribute__((aligned(16)));
static unsigned char buffer2[8] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){255, 255, 255, 255, 255, 255, 255, 255}, 8);
  bun_test_fill(buffer2, (const unsigned char[]){0, 254, 255, 0, 0, 0, 0, 0}, 8);
  stores((void *)buffer1, (void *)buffer2, 74565, 65791LL);
  bun_test_dump("buffer1", buffer1, 8);
  bun_test_dump("buffer2", buffer2, 8);
  printf("%d\n", (int)chain((void *)buffer2, 511));
  bun_test_dump("buffer2", buffer2, 8);
  printf("%d\n", (int)flags((void *)buffer2, 256));
  bun_test_dump("buffer2", buffer2, 8);
  printf("%d\n", (int)branches(8, 1LL, 0x0.0p+0));
  printf("%d\n", (int)branches(0, 0LL, 0x0.0p+0));
  printf("%d\n", (int)branches(0, 1LL, __builtin_nan("")));
  printf("%d\n", (int)branches(0, 1LL, 0x0.0p+0));
  printf("%d\n", (int)branches(4, 0LL, 0x0.0p+0));
  return 0;
}
