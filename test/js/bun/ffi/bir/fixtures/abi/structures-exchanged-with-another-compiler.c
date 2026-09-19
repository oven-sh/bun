// Structures by value between this compiler and another one (TinyCC, through bun:ffi's cc()), in both directions: each
// side calls every function of the other's for every shape: the shape as the first argument, after the argument
// registers are used up, between scalars, as a result, and handed to a callback that is the caller's own. Every value is
// checked against what the calling side computes for the same seed. (The over-aligned shapes, which TinyCC does not
// lay out, are checked against GCC's and Clang's register images in register-images-of-structures-on-x86-64.)
#include "structures-exchanged-with-another-compiler.shapes.c"

#define OURS(T) OFFER(ours, T)
EVERY_SHAPE(OURS)
#define OUR_ENTRIES(T) ENTRIES(ours, T)
static void *table[] = { EVERY_SHAPE(OUR_ENTRIES) 0 };
void **our_table(void) { return table; }

#define CHECK_THIS_SIDE(T) CHECK_AGAINST(T, ours)
int check_against(void **theirs) {
  int seed = 1, shapes = 0, wrong = 0;
  EVERY_SHAPE(CHECK_THIS_SIDE)
  printf("this compiler calls the other one: %d shapes, %d wrong\n", shapes - X87_SHAPE_COUNT, wrong);
  return wrong;
}
