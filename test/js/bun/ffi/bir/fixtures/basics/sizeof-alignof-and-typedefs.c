typedef unsigned long size_t;
         typedef struct Pair { char c; int i; } Pair, *PairPtr;
         typedef int Row[4];
         typedef int (*Cmp)(const void *, const void *);
         struct Packed { char a; char b; short c; };
         struct Padded { char a; double d; char z; };
         struct Empty1 { char only; };
         int sizes(void) {
             Row rows[3]; PairPtr p = 0; Cmp cmp = 0;
             return sizeof(Pair) + sizeof rows * 10 + sizeof p * 1000 + sizeof cmp * 10000 + sizeof(struct Packed) * 100000 + sizeof(struct Padded) * 1000000;
         }
         int aligns(void) { return _Alignof(char) + _Alignof(short) * 10 + _Alignof(double) * 100 + _Alignof(Pair) * 1000 + _Alignof(struct Padded) * 10000 + _Alignof(int[3]) * 100000; }
         int exprs(int n) { char c; short s; return sizeof(c + c) + sizeof(s) * 10 + sizeof(n + 1LL) * 100 + sizeof(1.0f) * 1000 + sizeof(1.0) * 10000 + sizeof(n++) * 100000 + n; }
         int abstract_decls(void) { return sizeof(int *) + sizeof(int (*)(int)) * 10 + sizeof(int[5]) * 100 + sizeof(char *[3]) * 10000 + sizeof(int (*)[7]) * 1000000; }
         size_t as_size(void) { return sizeof(size_t); }
         int offsetof_idiom(void) { return (int)(size_t)&((struct Padded *)0)->z; }
         _Static_assert(sizeof(Pair) == 8, "pair layout");

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sizes());
  printf("%d\n", (int)aligns());
  printf("%d\n", (int)exprs(7));
  printf("%d\n", (int)abstract_decls());
  printf("%lld\n", (long long)as_size());
  printf("%d\n", (int)offsetof_idiom());
  return 0;
}
