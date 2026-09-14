#include <stddef.h>
         struct t1 { unsigned x : 12; unsigned char y : 7; unsigned z : 28; unsigned a : 4; unsigned b : 5; };
         struct t2 { int x : 12; char y : 6; long long z : 63; char a : 4; long long b : 2; };
         struct __attribute__((packed)) p2 { int x : 12; char y : 6; long long z : 63; char a : 4; long long b : 2; };
         struct t3 { unsigned x : 5, y : 5, : 0, z : 5; char a : 5; short b : 5; };
         struct a3 { unsigned x : 5, y : 5, : 0, z : 5; char a : 5; __attribute__((aligned(16))) short b : 5; };
         #pragma pack(push, 1)
         struct k1 { unsigned x : 12; unsigned char y : 7; unsigned z : 28; unsigned a : 4; unsigned b : 5; };
         struct k6 { int a; signed char b; int x : 12, y : 4, : 0, : 4, z : 3; char d; };
         #pragma pack(pop)
         struct edge { char c; int x : 17; };
         int sizes[] = { sizeof(struct t1), sizeof(struct t2), sizeof(struct p2), sizeof(struct t3), sizeof(struct a3),
                         sizeof(struct k1), sizeof(struct k6), _Alignof(struct t2), _Alignof(struct p2), _Alignof(struct a3),
                         _Alignof(struct k6), sizeof(struct edge) };
         int size(int i) { return sizes[i]; }
         void fill(unsigned char *out, int which) {
             if (which == 1) { struct t1 s; __builtin_memset(&s, 0, sizeof s); s.x = -1; s.y = -1; s.z = -1; s.a = -1; s.b = -1; __builtin_memcpy(out, &s, sizeof s); }
             if (which == 2) { struct p2 s; __builtin_memset(&s, 0, sizeof s); s.x = 3; s.y = 30; s.z = 0x123456789abcdef0LL; s.a = 5; s.b = 2; __builtin_memcpy(out, &s, sizeof s); }
         }
         long long wide(void) { struct p2 s; s.x = -1; s.y = -1; s.a = -1; s.b = -1; s.z = 0x123456789abcdef0LL; s.z += 1; return s.z; }
         struct p2 initialized = { 3, 30, 0x123456789abcdef0LL, 5, -2 };
         long long from_data(void) { return initialized.z + initialized.b; }
         struct edge edges[2];
         int neighbour(void) { edges[1].c = 77; edges[0].x = -1; edges[0].c = 5; return edges[1].c * 100 + edges[0].c + (edges[0].x == -1); }
         struct promo { unsigned u31 : 31; unsigned u32 : 32; unsigned long ul31 : 31; unsigned long ul32 : 32; unsigned long long ull33 : 33; long long b : 2; } p;
         int promotions(void) {
             return (p.u31 - 100 < 0) * 100000 + (p.u32 - 100 < 0) * 10000 + (p.ul31 - 100 < 0) * 1000
                  + (p.ul32 - 100 < 0) * 100 + (p.ull33 - 100 < 0) * 10 + (sizeof(p.b + 0) == 4);
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
static unsigned char buffer1[32] __attribute__((aligned(16)));
int main(void) {
  printf("%d\n", (int)size(0));
  printf("%d\n", (int)size(1));
  printf("%d\n", (int)size(2));
  printf("%d\n", (int)size(3));
  printf("%d\n", (int)size(4));
  printf("%d\n", (int)size(5));
  printf("%d\n", (int)size(6));
  printf("%d\n", (int)size(7));
  printf("%d\n", (int)size(8));
  printf("%d\n", (int)size(9));
  printf("%d\n", (int)size(10));
  printf("%d\n", (int)size(11));
  for (int i = 0; i < 32; i++) buffer1[i] = 0;
  fill((void *)buffer1, 1);
  bun_test_dump("buffer1", buffer1, 32);
  fill((void *)buffer1, 2);
  bun_test_dump("buffer1", buffer1, 32);
  printf("%lld\n", (long long)wide());
  printf("%lld\n", (long long)from_data());
  printf("%d\n", (int)neighbour());
  printf("%d\n", (int)promotions());
  return 0;
}
