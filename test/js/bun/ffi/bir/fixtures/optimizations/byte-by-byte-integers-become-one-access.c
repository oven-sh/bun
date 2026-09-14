typedef unsigned char u8; typedef unsigned int u32; typedef unsigned long long u64; typedef unsigned long long SHA_LONG64;
         #define B(x, j) (((SHA_LONG64)(*(((const unsigned char *)(&x)) + j))) << ((7 - j) * 8))
         #define PULL64(x) (B(x, 0) | B(x, 1) | B(x, 2) | B(x, 3) | B(x, 4) | B(x, 5) | B(x, 6) | B(x, 7))
         u64 pull64(const u64 *w) { return PULL64(w[1]); }
         #define HOST_c2l_fixed(c, l) (l = (((unsigned long)((c)[0])) << 24), l |= (((unsigned long)((c)[1])) << 16), l |= (((unsigned long)((c)[2])) << 8), l |= (((unsigned long)((c)[3])))) /* long: any width */
         u32 sqlite3Get4byte(const u8 *p) { return ((unsigned)p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]; }
         void sqlite3Put4byte(unsigned char *p, u32 v) { p[0] = (u8)(v >> 24); p[1] = (u8)(v >> 16); p[2] = (u8)(v >> 8); p[3] = (u8)v; }
         #define get2byte(x) ((x)[0] << 8 | (x)[1])
         #define put2byte(p, v) ((p)[0] = (u8)((v) >> 8), (p)[1] = (u8)(v))
         int two(u8 *p, int v) { int old = get2byte(p + 2); put2byte(p + 2, v); return old; }
         #define U8TO32_LITTLE(p) (((u32)((p)[0])) | ((u32)((p)[1]) << 8) | ((u32)((p)[2]) << 16) | ((u32)((p)[3]) << 24))
         #define U32TO8_LITTLE(p, v) do { (p)[0] = (u8)(v >> 0); (p)[1] = (u8)(v >> 8); (p)[2] = (u8)(v >> 16); (p)[3] = (u8)(v >> 24); } while (0)
         void little(u8 *out, const u8 *in) { u32 v = U8TO32_LITTLE(in + 4) + 1; U32TO8_LITTLE(out, v); }
         u64 le64(const u8 *p) { return (u64)p[0] + ((u64)p[1] << 8) + ((u64)p[2] << 16) + ((u64)p[3] << 24) + ((u64)p[4] << 32) + ((u64)p[5] << 40) + ((u64)p[6] << 48) + ((u64)p[7] << 56); }
         void be64(u8 *p, u64 v) { p[7] = (u8)v; p[6] = (u8)(v >> 8); p[5] = (u8)(v >> 16); p[4] = (u8)(v >> 24); p[3] = (u8)(v >> 32); p[2] = (u8)(v >> 40); p[1] = (u8)(v >> 48); p[0] = (u8)(v >> 56); }
         u32 advance(const u8 **cursor) { const u8 *c = *cursor; u32 l = (u32)c[0] << 24 | (u32)c[1] << 16 | (u32)c[2] << 8 | c[3]; c += 4; *cursor = c; return l; }
         int signed_chars(const char *p) { return (p[0] & 0xff) | (p[1] & 0xff) << 8; }

         u32 mixed(const u8 *p, const u8 *q) { return (u32)p[0] << 24 | (u32)q[1] << 16 | (u32)p[2] << 8 | p[3]; }
         u32 watched(const volatile u8 *p) { return (u32)p[0] << 24 | (u32)p[1] << 16 | (u32)p[2] << 8 | p[3]; }
         u32 three(const u8 *p) { return (u32)p[0] << 16 | (u32)p[1] << 8 | p[2]; }
         u32 walking(const u8 *c) { u32 l; l = ((u32)(*(c++))) << 24; l |= ((u32)(*(c++))) << 16; l |= ((u32)(*(c++))) << 8; l |= ((u32)(*(c++))); return l; }
         u32 sign_extended(const u8 *p) { return (unsigned long long)((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >> 32; }
         void aliasing(u8 *p, const u32 *v) { p[0] = (u8)(*v >> 24); p[1] = (u8)(*v >> 16); p[2] = (u8)(*v >> 8); p[3] = (u8)*v; }
         void gap(u8 *p, u32 v) { p[0] = (u8)(v >> 24); p[1] = (u8)(v >> 16); p[3] = (u8)(v >> 8); p[4] = (u8)v; }

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
static unsigned char buffer3[8] __attribute__((aligned(16)));
static unsigned char buffer4[8] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}, 16);
  printf("%lld\n", (long long)pull64((void *)buffer1));
  printf("%d\n", (int)sqlite3Get4byte((void *)buffer1));
  printf("%lld\n", (long long)le64((void *)buffer1));
  printf("%d\n", (int)signed_chars((void *)buffer1));
  printf("%d\n", (int)three((void *)buffer1));
  printf("%d\n", (int)walking((void *)buffer1));
  printf("%d\n", (int)two((void *)buffer1, 43981));
  bun_test_dump("buffer1", buffer1, 16);
  for (int i = 0; i < 16; i++) buffer2[i] = 0;
  little((void *)buffer2, (void *)buffer1);
  bun_test_dump("buffer2", buffer2, 16);
  be64((void *)buffer2, 1234605616436508552LL);
  bun_test_dump("buffer2", buffer2, 16);
  sqlite3Put4byte((void *)buffer2, 168496141);
  bun_test_dump("buffer2", buffer2, 16);
  bun_test_fill(buffer3, (const unsigned char[]){128, 2, 3, 4, 0, 0, 0, 0}, 8);
  printf("%d\n", (int)sign_extended((void *)buffer3));
  *(unsigned char **)buffer4 = buffer1;
  printf("%d\n", (int)advance((void *)buffer4));
  printf("buffer4: buffer1 + %d\n", (int)(*(unsigned char **)buffer4 - buffer1));
  return 0;
}
