// A function with nothing of its own on the stack but a variable length array or an alloca: no locals in memory,
// no calls, no spills. When it returns, the stack pointer must be back where the caller left it, however it
// returns: at the end, early from inside nested scopes that each moved it again, or by a goto out of them.
// Called a hundred thousand times from a caller that watches its own locals and where its own locals live.
#include <stdint.h>
#include <stdio.h>
#if defined _WIN32
#include <malloc.h>
#elif __has_include(<alloca.h>)
#include <alloca.h>
#else
#include <stdlib.h>
#endif

#define NOINLINE __attribute__((noinline))
static int checks, wrong;
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

static NOINLINE int leaf_with_a_vla(int n) {
  unsigned char bytes[n];
  for (int i = 0; i < n; i++) bytes[i] = (unsigned char)(i * 3);
  int total = 0;
  for (int i = 0; i < n; i++) total += bytes[i];
  return total;
}
static NOINLINE int leaf_with_alloca(int n) {
  int *words = alloca((size_t)n * sizeof *words);
  for (int i = 0; i < n; i++) words[i] = i;
  int total = 0;
  for (int i = 0; i < n; i++) total += words[i] * 2;
  return total;
}
static NOINLINE long long leaf_with_both(int n) {
  long long first[n];
  short *second = alloca((size_t)n * sizeof *second);
  long long total = 0;
  for (int i = 0; i < n; i++) { first[i] = (long long)i << 33; second[i] = (short)-i; }
  for (int i = 0; i < n; i++) total += first[i] + second[i];
  return total;
}
// Early returns from inside nested scopes, each with its own array.
static NOINLINE int returns_from_inside(int n, int where) {
  char outer[n];
  outer[0] = 1; outer[n - 1] = 2;
  if (where == 0) return outer[0] + outer[n - 1];
  {
    int middle[n * 2];
    middle[0] = 10; middle[n * 2 - 1] = 20;
    if (where == 1) return middle[0] + middle[n * 2 - 1] + outer[0];
    for (int round = 0; round < 3; round++) {
      double inner[n + round];
      inner[0] = 100; inner[n + round - 1] = 200 + round;
      if (where == 2 + round) return (int)(inner[0] + inner[n + round - 1]) + middle[0] + outer[n - 1];
    }
  }
  return -1;
}
// Leaving the scopes by goto, forwards and out of a loop.
static NOINLINE int jumps_out(int n, int where) {
  int result = 0;
  {
    int first[n];
    first[n - 1] = 5;
    if (where == 0) { result = first[n - 1]; goto out; }
    for (int i = 0; i < 4; i++) {
      long second[n + i];
      second[n + i - 1] = 50 + i;
      if (where == i + 1) { result = (int)second[n + i - 1] + first[n - 1]; goto out; }
    }
    result = -1;
  }
out:
  return result;
}
// Going round again over a declaration makes the array anew each time: the stack must not grow with the rounds.
static NOINLINE unsigned round_and_round(int n, int rounds) {
  unsigned total = 0;
  int round = 0;
again:;
  int fresh[n];
  fresh[0] = round; fresh[n - 1] = 1;
  total += (unsigned)(fresh[0] + fresh[n - 1]);
  if (++round < rounds) goto again;
  return total;
}

int main(void) {
  volatile long long guard_before = 0x1122334455667788LL;
  int sums[4] = {0, 0, 0, 0};
  volatile long long guard_after = 0x0fedcba987654321LL;
  char *frame_at_first = 0;
  int drifted = 0;
  long long wide = 0;
  for (int i = 0; i < 100000; i++) {
    int n = 1 + i % 97;
    sums[0] += leaf_with_a_vla(n) & 0xff;
    sums[1] += leaf_with_alloca(n) & 0xff;
    wide += leaf_with_both(1 + i % 13);
    sums[2] += returns_from_inside(2 + i % 50, i % 6);
    sums[3] += jumps_out(1 + i % 40, i % 6);
    char here;
    char *now = &here;
    if (!frame_at_first) frame_at_first = now;
    drifted |= now != frame_at_first;
  }
  CHECK(guard_before == 0x1122334455667788LL && guard_after == 0x0fedcba987654321LL && !drifted);
  // The same sums, computed without any of it.
  int expected[4] = {0, 0, 0, 0};
  long long expected_wide = 0;
  for (int i = 0; i < 100000; i++) {
    int n = 1 + i % 97, vla = 0, words = 0;
    for (int k = 0; k < n; k++) { vla += (unsigned char)(k * 3); words += k * 2; }
    expected[0] += vla & 0xff; expected[1] += words & 0xff;
    int m = 1 + i % 13;
    for (int k = 0; k < m; k++) expected_wide += ((long long)k << 33) - k;
    int where = i % 6;
    expected[2] += where == 0 ? 3 : where == 1 ? 31 : where <= 4 ? 300 + (where - 2) + 10 + 2 : -1;
    expected[3] += where == 0 ? 5 : where <= 4 ? 50 + (where - 1) + 5 : -1;
  }
  CHECK(sums[0] == expected[0]); CHECK(sums[1] == expected[1]); CHECK(wide == expected_wide); CHECK(sums[2] == expected[2]); CHECK(sums[3] == expected[3]);
  CHECK(round_and_round(1000, 100000) == (unsigned)(100000ull + 99999ull * 100000ull / 2));
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
