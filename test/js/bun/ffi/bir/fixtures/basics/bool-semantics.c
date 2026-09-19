#include <stdbool.h>
int from_int(int v) { _Bool b = v; return b; }
         int from_double(double d) { _Bool b = d; return b; }
         int from_ptr(void) { int x; _Bool b = &x; _Bool n = (void *)0; return b * 2 + n; }
         int inc(void) { _Bool b = 1; b++; int r = b; b--; r = r * 2 + b; b--; return r * 2 + b; }
         _Bool ret(int v) { return v; }
         int size(void) { return sizeof(_Bool) + sizeof(bool); }
         int literals(void) { bool t = true, f = false; return t * 2 + f; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)from_int(256));
  printf("%d\n", (int)from_int(0));
  printf("%d\n", (int)from_double(0x1.0000000000000p-2));
  printf("%d\n", (int)from_double(0x0.0p+0));
  printf("%d\n", (int)from_ptr());
  printf("%d\n", (int)inc());
  printf("%d\n", (int)ret(256));
  printf("%d\n", (int)size());
  printf("%d\n", (int)literals());
  return 0;
}
