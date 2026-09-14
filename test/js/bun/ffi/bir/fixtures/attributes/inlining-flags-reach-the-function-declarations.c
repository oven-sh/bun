static inline int hinted(int x) { return x + 1; }
         static __inline__ __attribute__((always_inline)) int forced(int x) { return x + 2; }
         static __attribute__((noinline)) int kept(int x) { return x + 3; }
         __attribute__((__always_inline__, __noinline__)) static int both(int x) { return x + 4; }
         static int late(int x); inline static int late(int x) { return x + 5; }
         int plain(int x) { return hinted(x) + forced(x) + kept(x) + both(x) + late(x); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)plain(10));
  return 0;
}
