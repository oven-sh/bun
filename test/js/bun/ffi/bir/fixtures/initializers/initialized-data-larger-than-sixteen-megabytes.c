// More than 16 MiB of initialized data in each of the three places data lives: a table of constants, a table the
// program writes to, and a thread-local one. Each has something at both ends and in the middle, so that all of it has
// to be there; the zeros in between are not a reason to leave any of it out. (A module's format used to count these
// bytes with a counter that stops at 16 MiB.)
#include <stdio.h>

enum { N = 17 << 20 };
static const unsigned char constants[N] = { [0] = 1, [N / 2] = 2, [N - 1] = 3 };
static unsigned char written[N] = { [0] = 4, [N / 2 + 1] = 5, [N - 1] = 6 };
static _Thread_local unsigned char for_each_thread[N] = { [0] = 7, [N / 3] = 8, [N - 1] = 9 };
// And one that is nothing but zeros, after them all.
static unsigned char zeros[N];

static unsigned long long sum(const volatile unsigned char *bytes) {
  unsigned long long total = 0;
  for (unsigned long long i = 0; i < N; i++) total += bytes[i] * (i % 251 + 1);
  return total;
}

int main(void) {
  volatile unsigned long long middle = N / 2;
  printf("%d %d %d %llu\n", constants[0], constants[middle], constants[N - 1], sum(constants));
  printf("%d %d %d %llu\n", written[0], written[middle + 1], written[N - 1], sum(written));
  printf("%d %d %d %llu\n", for_each_thread[0], for_each_thread[N / 3], for_each_thread[N - 1], sum(for_each_thread));
  written[middle] = 10;
  for_each_thread[middle] = 11;
  zeros[N - 1] = 12;
  printf("%llu %llu %llu\n", sum(written), sum(for_each_thread), sum(zeros));
  return 0;
}
