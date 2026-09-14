typedef const int cint;
         const int limit = 10; cint other = 20; const char *const names[] = { "a", "bc" };
         struct point { int x; const int id; };
         int read(const struct point *p, const int *q) { return p->x + p->id + *q + limit + other + names[1][1]; }
         int pick(void) {
             const int local = 1; int plain = 2; const int *pc = &local; int *pp = &plain; int *const cp = &plain;
             *cp = 3;
             return _Generic(local, int: 1, default: 0)
                  + _Generic(&local, const int *: 10, int *: 20)
                  + _Generic(pc, const int *: 100, int *: 200)
                  + _Generic(pp, const int *: 1000, int *: 2000)
                  + _Generic(cp, int *: 10000, default: 0)
                  + _Generic(0 ? pc : pp, const int *: 100000, int *: 200000)
                  + _Generic(0 ? (volatile long *)0 : (const long *)0, const volatile long *: 1000000, default: 0)
                  + _Generic("text", char *: 10000000, const char *: 20000000)
                  + _Generic((const int)plain, int: 100000000, default: 0);
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
static unsigned char buffer1[8] __attribute__((aligned(16)));
static unsigned char buffer2[8] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){5, 0, 0, 0, 7, 0, 0, 0}, 8);
  bun_test_fill(buffer2, (const unsigned char[]){3, 0, 0, 0, 0, 0, 0, 0}, 8);
  printf("%d\n", (int)read((void *)buffer1, (void *)buffer2));
  printf("%d\n", (int)pick());
  return 0;
}
