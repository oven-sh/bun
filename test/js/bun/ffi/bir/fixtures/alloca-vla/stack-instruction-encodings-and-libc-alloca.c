#ifdef _WIN32
#include <malloc.h> // where Windows declares it, as _alloca
#undef alloca
#define alloca(n) _alloca(n)
#else
#include <alloca.h>
#endif
        #include <stdlib.h>
        #include <string.h>
        int f(int n) { char *p = alloca(n); memset(p, 7, n); int *q = (int *)alloca(sizeof(int) * 2); q[1] = 5; return p[n - 1] + q[1]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)f(9));
  return 0;
}
