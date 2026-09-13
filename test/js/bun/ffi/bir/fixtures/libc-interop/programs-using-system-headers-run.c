#include <stdio.h>
           #include <stdlib.h>
           #include <string.h>
           #include <stdint.h>
           #include <inttypes.h>
           #include <math.h>
           #include <ctype.h>
           #include <errno.h>
           #include <assert.h>
           #include <limits.h>
           #include <stdbool.h>
           int strings(void) {
               char buf[32];
               strcpy(buf, "hello");
               strcat(buf, ", world");
               char *comma = strchr(buf, ',');
               assert(comma != NULL);
               return (int)strlen(buf) * 100 + (int)(comma - buf) + (strcmp(buf, "hello, world") == 0) * 10000 + (strncmp(buf, "help", 3) == 0) * 100000 + (memcmp(buf, "hellx", 5) < 0) * 1000000;
           }
           int heap(int n) {
               int *v = malloc(sizeof *v * (size_t)n);
               if (!v) return -1;
               for (int i = 0; i < n; i++) v[i] = i * i;
               v = realloc(v, sizeof *v * (size_t)(n + 1));
               v[n] = 1000;
               long sum = 0;
               for (int i = 0; i <= n; i++) sum += v[i];
               free(v);
               char *z = calloc(4, 4);
               int zero = z[15];
               free(z);
               return (int)sum + zero;
           }
           int formatted(void) {
               char buf[64];
               uint64_t big = UINT64_C(18446744073709551615);
               int n = snprintf(buf, sizeof buf, "%" PRIu64 " %" PRId32 " %" PRIx16 " %zu", big, INT32_MIN, (uint16_t)0xbeef, sizeof big);
               printf("%s|%d\n", buf, n);
               fprintf(stderr, "[%5.1f]\n", sqrt(2.0) * pow(2, 3));
               long parsed = strtol("  -0x1f rest", NULL, 0);
               char *end;
               unsigned long dec = strtoul("12345abc", &end, 10);
               return (int)parsed + (int)dec + *end + atoi("42");
           }
           int classify(const char *s) {
               int letters = 0, digits = 0, spaces = 0, uppers = 0;
               for (; *s; s++) {
                   if (isalpha((unsigned char)*s)) letters++;
                   if (isdigit((unsigned char)*s)) digits++;
                   if (isspace((unsigned char)*s)) spaces++;
                   if (isupper((unsigned char)*s)) uppers++;
               }
               return letters * 1000 + digits * 100 + spaces * 10 + uppers + toupper('q');
           }
           int errors(void) { errno = 0; errno = ERANGE; int saved = errno; errno = 0; return saved == ERANGE && errno == 0 && EINVAL == 22; }
           double maths(double x) { return floor(x) + ceil(x) + fabs(-x) + (isnan(NAN) ? 100 : 0) + (isinf(INFINITY) ? 1000 : 0) + (M_PI > 3.14 ? 10000 : 0); }
           int failing_assert(int x) { assert(x > 0 && "x must be positive"); return x; }
           bool limits_ok(void) { return PATH_MAX >= 256 && CHAR_BIT == 8 && SSIZE_MAX == LONG_MAX && RAND_MAX >= 32767 && EXIT_FAILURE == 1 && BUFSIZ > 0; }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[16] __attribute__((aligned(16)));
int main(void) {
  printf("%d\n", (int)strings());
  printf("%d\n", (int)heap(10));
  printf("%d\n", (int)formatted());
  bun_test_fill(buffer1, (const unsigned char[]){72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 32, 52, 50, 0, 0}, 16);
  printf("%d\n", (int)classify((void *)buffer1));
  printf("%d\n", (int)errors());
  printf("%.17g\n", (double)maths(0x1.4000000000000p+1));
  printf("%d\n", (int)failing_assert(3));
  printf("%d\n", (int)limits_ok());
  return 0;
}
