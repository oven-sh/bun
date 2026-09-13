volatile int v; _Atomic long a; typedef volatile unsigned vu; vu w;
         int pick(void) { return _Generic(v, int: 1, default: 0) + _Generic(a, long: 10, default: 0) + _Generic(w, unsigned: 100, default: 0) + _Generic(&v, volatile int *: 1000, int *: 2000); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)pick());
  return 0;
}
