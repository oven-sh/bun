#include <stdlib.h>
        #include <string.h>
        #include <time.h>
        #include <sys/time.h>
        #include <arpa/inet.h>
        int divide(int n, int d) { div_t r = div(n, d); return r.quot * 100 + r.rem; }
        long divide_long(long n, long d) { ldiv_t r = ldiv(n, d); return r.quot * 1000 + r.rem + ldiv(7, 2).rem; }
        int address(void) { struct in_addr a; a.s_addr = 0x0100007f; return strcmp(inet_ntoa(a), "127.0.0.1") == 0; }
        static struct timespec later(struct timespec t, long ns) { t.tv_nsec += ns; if (t.tv_nsec >= 1000000000L) { t.tv_sec++; t.tv_nsec -= 1000000000L; } return t; }
        long timespecs(void) { struct timespec t = { 5, 999999999L }; struct timeval tv = { 1, 2 }; struct timespec u = later(t, 2); return u.tv_sec * 100 + u.tv_nsec + tv.tv_usec * 10; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)divide(47, 5));
  printf("%lld\n", (long long)divide_long(-47LL, 5LL));
  printf("%d\n", (int)address());
  printf("%lld\n", (long long)timespecs());
  return 0;
}
