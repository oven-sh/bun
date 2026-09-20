typedef unsigned int u32; typedef unsigned long long u64;
         void *memcpy(void *, const void *, __SIZE_TYPE__); void *memset(void *, int, __SIZE_TYPE__);
         typedef union { u32 u[16]; unsigned char c[64]; } block;
         #define ROTATE(v, n) (((v) << (n)) | ((v) >> (32 - (n))))
         #define QR(a, b, c, d) (x[a] += x[b], x[d] = ROTATE((x[d] ^ x[a]), 16), x[c] += x[d], x[b] = ROTATE((x[b] ^ x[c]), 12))
         void core(block *output, const u32 input[16]) {
             u32 x[16]; int i;
             memcpy(x, input, sizeof(x));
             for (i = 20; i > 0; i -= 2) { QR(0, 4, 8, 12); QR(1, 5, 9, 13); QR(2, 6, 10, 14); QR(3, 7, 11, 15); }
             for (i = 0; i < 16; ++i) output->u[i] = x[i] + input[i];
         }
         struct point { int x, y; struct { short lo, hi; } range; double w; };
         double members(const struct point *p, int k) {
             struct point a = *p, b = { 1, 2, { 3, 4 }, 0.5 }, c;
             memset(&c, 0, sizeof c); c.range.hi = (short)k; a.x += b.y; b = a; c.w = b.w * 2;
             struct point d; d = c; return a.x + b.x * 10 + b.range.lo * 100 + d.range.hi * 1000 + d.w + c.y;
         }
         u64 theta(const u64 a[5]) { u64 C[5], D[5]; int i;
             for (i = 0; i < 5; i++) C[i] = a[i] ^ (a[i] << 1);
             D[0] = C[4] ^ C[1]; D[1] = C[0] ^ C[2]; D[2] = C[1] ^ C[3]; D[3] = C[2] ^ C[4]; D[4] = C[3] ^ C[0];
             return D[0] + D[1] * 3 + D[2] * 5 + D[3] * 7 + D[4] * 11; }
         int escapes(int k) { int v[4] = { 1, 2, 3, 4 }; int *p = &v[1]; return p[k] + v[0]; }
         int variable_index(int k) { int v[4] = { 1, 2, 3, 4 }; return v[k & 3]; }
         extern int sum(const int *, int); int passed(void) { int v[3] = { 1, 2, 3 }; return sum(v, 3); }
         int punned(void) { union { int i; float f; } u; u.f = 1.0f; return u.i; }
         int counter_changes(void) { int v[4] = { 0 }, i; for (i = 0; i < 4; i++) { v[i] = i; if (i == 1) i++; } return v[0] + v[1] + v[2] * 10 + v[3] * 100 + i * 1000; }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[64] __attribute__((aligned(16)));
static unsigned char buffer2[64] __attribute__((aligned(16)));
static unsigned char buffer3[24] __attribute__((aligned(16)));
static unsigned char buffer4[40] __attribute__((aligned(16)));
int main(void) {
  for (int i = 0; i < 64; i++) buffer1[i] = 0;
  bun_test_fill(buffer2, (const unsigned char[]){185, 121, 55, 158, 114, 243, 110, 60, 43, 109, 166, 218, 228, 230, 221, 120, 157, 96, 21, 23, 86, 218, 76, 181, 15, 84, 132, 83, 200, 205, 187, 241, 129, 71, 243, 143, 58, 193, 42, 46, 243, 58, 98, 204, 172, 180, 153, 106, 101, 46, 209, 8, 30, 168, 8, 167, 215, 33, 64, 69, 144, 155, 119, 227}, 64);
  core((void *)buffer1, (void *)buffer2);
  bun_test_dump("buffer1", buffer1, 64);
  bun_test_fill(buffer3, (const unsigned char[]){7, 0, 0, 0, 8, 0, 0, 0, 255, 255, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 244, 63}, 24);
  printf("%.17g\n", (double)members((void *)buffer3, 6));
  bun_test_fill(buffer4, (const unsigned char[]){1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0}, 40);
  printf("%lld\n", (long long)theta((void *)buffer4));
  printf("%d\n", (int)escapes(2));
  printf("%d\n", (int)variable_index(6));
  printf("%d\n", (int)passed());
  printf("%d\n", (int)punned());
  printf("%d\n", (int)counter_changes());
  return 0;
}
