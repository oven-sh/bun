#if __SIZEOF_INT128__ != 16
         #error no __int128
         #endif
         #define BIT_INTERLEAVE (0)
         static unsigned long long rol(unsigned long long val, int offset) {
             if (offset == 0) { return val; } else if (!BIT_INTERLEAVE) { return (val << offset) | (val >> (64 - offset)); }
             else { unsigned hi = (unsigned)(val >> 32), lo = (unsigned)val; if (offset & 1) { unsigned tmp = hi; offset >>= 1; hi = lo << offset | lo >> (32 - offset); lo = tmp; } return ((unsigned long long)hi << 32) | lo; }
         }
         unsigned long long use(unsigned long long v, int n) { return rol(v, n); }
         int after_return(int x) { return x; x++; return x + 1; }

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)use(3LL, 62));
  printf("%d\n", (int)after_return(5));
  return 0;
}
