typedef long double ld_t;
         struct Holder { char c; long double ld; __int128 big; _Complex double z; float _Complex fz; };
         long double strtold(const char *, char **);
         __int128 add128(__int128, unsigned __int128);
         struct div_result { int quot, rem; };
         struct div_result div(int, int);
         static ld_t stored;
         static struct Holder a, b;
         int sizes(void) { return sizeof(long double) + sizeof(struct Holder) * 100 + _Alignof(long double) * 100000 + sizeof(__int128_t) * 1000000 + sizeof(double _Complex) * 100000000; }
         int copy(void) { a.c = 5; b = a; struct Holder local = b; long double *p = &stored; (void)p; return local.c; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sizes());
  printf("%d\n", (int)copy());
  return 0;
}
