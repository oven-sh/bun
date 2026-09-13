typedef unsigned long long __attribute__((aligned(4))) unaligned_u64;
         struct lowered { unsigned int n; unaligned_u64 start; };
         struct natural { unsigned int n; unsigned long long start; };
         typedef struct later later_t; typedef __attribute__((aligned(64))) struct later { int x; } later_t;
         typedef float four __attribute__((__mode__(__V4SF__)));
         struct pair { int a, b; } table[2] __attribute__((aligned(32)));
         int layout(void) { return sizeof(struct lowered) * 1000000 + __alignof__(struct lowered) * 100000 + sizeof(struct natural) * 1000
             + __alignof__(table) + (sizeof(four) == 16) * 100 + (__alignof__(later_t) == 64) * 200; }
         static int v1 = 34 ?: -1, v2 = 0 ?: -1;
         int old_style(a, b) int a; char *b; { return a + (b != 0); }
         static int num(int x) { return x + 1; }
         int gnu(void) { int (*f)(int) = num; long diff; f = num + 0; diff = f - num;
             int here = ({ __label__ l; l: 40 + 2; });
             switch (diff) { case 0: __extension__({ here++; }); }
             return v1 * 1000 + v2 * -100 + old_style((void *)3, "s") * 10000 + (f + diff)(here) * 100000; }
         void fences(int *p) { __asm__ volatile("lock; orl $0, (%%rsp)" ::: "memory"); *p = 1; __asm__ volatile("mfence"); __asm__ volatile("sfence" ::: "memory"); }
         void stop(unsigned long why) { __asm__ volatile("int3" : : "r"(why)); __builtin_unreachable(); }
         static inline int wide_cas(unsigned __int128 *p, unsigned __int128 *e, unsigned __int128 v) { return __atomic_compare_exchange_n(p, e, v, 0, 5, 5); }
         #define inc < dir name >
         #define dir std
         #define name def.h
         #include inc
         size_t from_header(void) { return sizeof(ptrdiff_t); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)layout());
  printf("%d\n", (int)gnu());
  printf("%lld\n", (long long)from_header());
  return 0;
}
