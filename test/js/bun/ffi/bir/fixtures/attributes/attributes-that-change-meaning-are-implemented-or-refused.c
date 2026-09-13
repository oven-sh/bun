typedef int ti_int __attribute__((mode(TI))); typedef unsigned tu_int __attribute__((__mode__(__TI__)));
         typedef int di __attribute__((mode(DI))); typedef unsigned hi __attribute__((mode(HI))); typedef int qi __attribute__((mode(QI)));
         typedef int word __attribute__((mode(__word__))); typedef unsigned ptr_t __attribute__((mode(pointer))); typedef float df __attribute__((mode(DF)));
         typedef int cmp_t __attribute__((__mode__(__libgcc_cmp_return__)));
         char assumption[sizeof(ti_int) == 2 * sizeof(di) ? 1 : -1] = { 0 };
         int sizes(void) { int __attribute__((mode(DI))) wide = 0; return sizeof(ti_int) * 100000 + sizeof(tu_int) * 1000 + sizeof(di) * 100 + sizeof(hi) * 10 + sizeof(qi) + sizeof(word) * 1000000 + sizeof(ptr_t) * 10000000 + sizeof(df) * 100000000 + (sizeof wide == 8) + (sizeof(cmp_t) == 8); }
         int signs(void) { return ((tu_int)-1 > 0) + ((ti_int)-1 < 0) * 2 + ((hi)-1 == 65535) * 4 + ((qi)200 < 0) * 8; }
         unsigned long long high(tu_int x) { return (unsigned long long)(x >> 64); }
         tu_int umod(tu_int a, tu_int b) { return a % b; }

         static int log_[8], n;
         static void note(int *p) { log_[n++] = *p; }
         static void release(char **p) { log_[n++] = (*p)[0]; }
         int scopes(int how) {
             n = 0;
             int outer __attribute__((cleanup(note))) = 1;
             for (int i = 0; i < 2; i++) {
                 int loop __attribute__((cleanup(note))) = 10 + i;
                 if (how == 1 && i == 0) continue;
                 if (how == 2) break;
                 if (how == 3) return 100 + n;
                 { char *text __attribute__((__cleanup__(release))) = "x"; if (how == 4) goto out; }
                 loop += 5;
             }
           out:
             outer = 2;
             return n;
         }
         int logged(int i) { return log_[i]; }

         typedef union { int *ip; const char *cp; void *vp; } any_pointer __attribute__((__transparent_union__));
         int first_byte(any_pointer p) { return *p.cp; }
         int through(void) { int value = 0x41; char text[] = "z"; return first_byte(&value) * 1000 + first_byte(text) + (first_byte((void *)text) == 'z'); }

         enum { wide_is_signed = ((ti_int)-1) < 0, wide_unsigned = ((tu_int)-1) < 0, top = (int)(((tu_int)1 << 100) >> 98) };
         _Static_assert(sizeof(char[((__int128)1 << 70) >> 68]) == 4, "128-bit constant expressions");
         int constants(unsigned __int128 v) { switch ((int)(v >> 64)) { case (int)(((unsigned __int128)7 << 64) >> 64): return wide_is_signed * 100 + wide_unsigned * 10 + top; default: return -1; } }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sizes());
  printf("%d\n", (int)signs());
  printf("%d\n", (int)scopes(0));
  printf("%d\n", (int)logged(0));
  printf("%d\n", (int)logged(1));
  printf("%d\n", (int)logged(2));
  printf("%d\n", (int)logged(3));
  printf("%d\n", (int)logged(4));
  printf("%d\n", (int)logged(5));
  printf("%d\n", (int)logged(6));
  printf("%d\n", (int)scopes(1));
  printf("%d\n", (int)logged(0));
  printf("%d\n", (int)logged(1));
  printf("%d\n", (int)logged(2));
  printf("%d\n", (int)logged(3));
  printf("%d\n", (int)scopes(2));
  printf("%d\n", (int)logged(0));
  printf("%d\n", (int)logged(1));
  printf("%d\n", (int)scopes(3));
  printf("%d\n", (int)logged(0));
  printf("%d\n", (int)logged(1));
  printf("%d\n", (int)scopes(4));
  printf("%d\n", (int)logged(0));
  printf("%d\n", (int)logged(1));
  printf("%d\n", (int)logged(2));
  printf("%d\n", (int)through());
  return 0;
}
