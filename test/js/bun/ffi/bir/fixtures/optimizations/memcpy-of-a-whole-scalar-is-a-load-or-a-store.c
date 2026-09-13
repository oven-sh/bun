void *memcpy(void *, const void *, unsigned long); void *memmove(void *, const void *, unsigned long); void *memset(void *, int, unsigned long);
         typedef unsigned int u32; typedef unsigned long long u64;
         static u32 read32(const void *p) { u32 v; memcpy(&v, p, sizeof v); return v; }
         static u64 read64(const void *p) { u64 v; __builtin_memcpy(&v, p, sizeof(v)); return v; }
         static void write16(void *p, unsigned short v) { memcpy(p, &v, sizeof v); }
         u64 reads(const unsigned char *p) { return read32(p + 1) + read64(p + 3); }
         void writes(unsigned char *p, int v) { write16(p + 1, (unsigned short)v); }
         u64 bits_of(double d) { u64 u; memcpy(&u, &d, sizeof u); return u; }
         float float_of(u32 u) { float f; (void)memmove(&f, &u, 4); return f; }
         int narrow(const void *p) { signed char c; short s; _Bool b; memcpy(&c, p, 1); memcpy(&s, p, 2); memcpy(&b, p, 1); return c * 100000 + s + b * 10000000; }
         short resign(unsigned short u) { short s; memcpy(&s, &u, 2); return s; }
         int partial(const void *p) { int v = 0; memcpy(&v, p, 3); return v; }
         int escapes(const void *p) { int v; int *q = &v; memcpy(&v, p, sizeof v); return *q; }
         void *result_used(void *d, const void *s) { int v; void *r = memcpy(&v, s, 4); memcpy(d, &v, 4); return r == (void *)&v ? d : 0; }
         void *general(void *d, const void *s, unsigned long n) { memset(d, 0x5a, n + 4); return memcpy(d, s, n); }

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
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){241, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255, 0}, 16);
  printf("%lld\n", (long long)reads((void *)buffer1));
  printf("%d\n", (int)narrow((void *)buffer1));
  printf("%d\n", (int)partial((void *)buffer1));
  printf("%d\n", (int)escapes((void *)buffer1));
  writes((void *)buffer1, 114415);
  bun_test_dump("buffer1", buffer1, 16);
  printf("%lld\n", (long long)bits_of(0x1.0000000000000p+0));
  printf("%.9g\n", (double)float_of(1069547520));
  printf("%d\n", (int)resign(65534));
  for (int i = 0; i < 16; i++) buffer2[i] = 0;
  printf("%d\n", (int)((unsigned char *)general((void *)buffer2, (void *)buffer1, 3LL) - buffer2));
  bun_test_dump("buffer2", buffer2, 16);
  printf("%d\n", (int)((unsigned char *)result_used((void *)buffer2, (void *)buffer1) - buffer2));
  bun_test_dump("buffer2", buffer2, 16);
  return 0;
}
