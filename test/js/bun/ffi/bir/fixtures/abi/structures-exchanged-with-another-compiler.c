// Structures by value between this compiler and another one (TinyCC, through bun:ffi's cc()), in both directions: each
// shape as the first argument, after the argument registers are used up, between scalars, as a result, and handed to a
// callback. Every value is checked against what this side computes for the same seed. (The over-aligned shapes, which
// TinyCC does not lay out, are checked against GCC's and Clang's register images in over-aligned-structures-*.)
#include <stdio.h>
#include "structures-exchanged-with-another-compiler.shapes.c"

#define OURS(T) OFFER(ours, T)
EVERY_SHAPE(OURS)
#define OUR_ENTRIES(T) ENTRIES(ours, T)
static void *table[] = { EVERY_SHAPE(OUR_ENTRIES) 0 };
void **our_table(void) { return table; }

static int wrong;
static void expect(const char *shape, const char *what, long long got, long long want) {
  if (got != want) { wrong++; printf("%s %s: got %lld, expected %lld\n", shape, what, got, want); }
}

// Calls every one of the other side's functions for every shape and checks what comes back.
#define CHECK_AGAINST(T) { \
    T s; fill_##T(&s, seed); long long h = hash_##T(&s); \
    long long (*first)(T, long long) = (long long (*)(T, long long))theirs[0]; \
    long long (*late)(long long, long long, long long, long long, long long, long long, double, double, double, double, double, double, double, double, T, long long) = theirs[1]; \
    long long (*between)(int, double, T, float, long long) = (long long (*)(int, double, T, float, long long))theirs[2]; \
    T (*make)(int) = (T (*)(int))theirs[3]; \
    long long (*back)(long long (*)(T, long long), int) = (long long (*)(long long (*)(T, long long), int))theirs[4]; \
    expect(#T, "first", first(s, 5), h * 1000 + 5); \
    expect(#T, "late", late(1, 2, 3, 4, 5, 6, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, s, 9), h * 1000 + 9 + 21 + 36); \
    expect(#T, "between", between(3, 1.5, s, 0.25f, 11), h * 1000 + 11 + 3 + 3 + 1); \
    T made = make(seed + 1); T same; fill_##T(&same, seed + 1); \
    expect(#T, "result", hash_##T(&made), hash_##T(&same)); \
    expect(#T, "called back", back(ours_first_##T, seed), h * 1000 + 7); \
    theirs += 5; seed += 3; shapes++; }

int check_against(void **theirs) {
  int seed = 1, shapes = 0;
  EVERY_SHAPE(CHECK_AGAINST)
  printf("%d shapes, %d wrong\n", shapes, wrong);
  return wrong;
}
