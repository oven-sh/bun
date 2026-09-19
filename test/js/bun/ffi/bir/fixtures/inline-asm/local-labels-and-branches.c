/* Branches inside an asm statement go to numeric local labels: `1b` is the nearest `1:` before, `1f` the nearest
   after, and a number can be used again. A branch that does not reach with one byte of displacement gets four. */
#include <stdint.h>
#include <stdio.h>

static int checks, wrong;
#define CHECK(condition) \
  do { \
    checks++; \
    if (!(condition)) { \
      wrong++; \
      printf("WRONG (line %d): %s\n", __LINE__, #condition); \
    } \
  } while (0)

/* Ten and a hundred copies of an instruction, to put distance between a branch and its label. */
#define TEN(text) text text text text text text text text text text
#define HUNDRED(text) TEN(TEN(text))

static uint64_t sum_below(uint64_t n) {
  uint64_t total = 0;
  __asm__("1:\n testq %1, %1\n jz 2f\n decq %1\n addq %1, %0\n jmp 1b\n2:" : "+r"(total), "+r"(n) : : "cc");
  return total;
}

/* The same label number three times: each branch takes the nearest in its direction. */
static uint64_t nearest(uint64_t start) {
  __asm__("jmp 1f\n addq $100, %0\n1:\n addq $1, %0\n jmp 1f\n addq $100, %0\n1:\n addq $1, %0\n cmpq $50, %0\n jae 2f\n addq $50, %0\n jmp 1b\n2:" : "+r"(start) : : "cc");
  return start;
}

/* A forward and a backward branch over more than 127 bytes of code (seven bytes each time). */
static uint64_t far_forward(uint64_t take) {
  uint64_t out = 0;
  __asm__("testq %1, %1\n jnz 1f\n" HUNDRED("addq $0x1000, %0\n") "1:\n addq $1, %0" : "+r"(out) : "r"(take) : "cc");
  return out;
}
static uint64_t far_backward(uint64_t rounds) {
  uint64_t out = 0;
  __asm__("1:\n" HUNDRED("addq $0x1000, %0\n") "decq %1\n jnz 1b" : "+r"(out), "+r"(rounds) : : "cc");
  return out;
}
static uint64_t far_jump(void) {
  uint64_t out = 0;
  __asm__("jmp 1f\n" HUNDRED("addq $0x1000, %0\n") "1:\n addq $1, %0" : "+r"(out) : : "cc");
  return out;
}
/* Short ones that become long because a long one between them grew. */
static uint64_t nested(uint64_t a) {
  uint64_t out = 0;
  __asm__("testq %1, %1\n jz 2f\n jmp 1f\n" TEN("addq $0x1000, %0\n") TEN("nop\n") TEN("nop\n") TEN("nop\n") TEN("nop\n") "nop\n nop\n nop\n nop\n nop\n nop\n nop\n nop\n1:\n addq $1, %0\n2:\n addq $2, %0"
          : "+r"(out) : "r"(a) : "cc");
  return out;
}

/* Every condition branches when its setcc would set. */
#define BRANCHES(cc, a, b) ({ uint64_t _taken = 0; __asm__("cmpl %2, %1\n j" cc " 1f\n jmp 2f\n1:\n movq $1, %0\n2:" : "+r"(_taken) : "r"(a), "r"(b) : "cc"); _taken; })

int main(void) {
  CHECK(sum_below(10) == 45 && sum_below(0) == 0 && sum_below(1) == 0);
  CHECK(nearest(0) == 53);
  CHECK(far_forward(1) == 1 && far_forward(0) == 100 * 0x1000 + 1);
  CHECK(far_backward(1) == 100 * 0x1000 && far_backward(3) == 300 * 0x1000);
  CHECK(far_jump() == 1);
  CHECK(nested(1) == 3 && nested(0) == 2);
  const int32_t minus = -1, one = 1;
  CHECK(BRANCHES("e", one, one) && !BRANCHES("e", one, minus) && BRANCHES("ne", one, minus) && BRANCHES("z", one, one) && BRANCHES("nz", minus, one));
  CHECK(BRANCHES("l", minus, one) && !BRANCHES("b", minus, one) && BRANCHES("a", minus, one) && BRANCHES("g", one, minus));
  CHECK(BRANCHES("le", one, one) && BRANCHES("ge", one, one) && BRANCHES("be", one, one) && BRANCHES("ae", one, one));
  CHECK(BRANCHES("s", minus, one) && BRANCHES("ns", one, minus) && BRANCHES("c", one, minus) && BRANCHES("nc", minus, one));
  CHECK(BRANCHES("o", INT32_MIN, one) && BRANCHES("no", one, one) && BRANCHES("p", one, one) && BRANCHES("np", 2, 1));
  CHECK(BRANCHES("na", one, one) && BRANCHES("nb", one, one) && BRANCHES("nl", one, one) && BRANCHES("ng", one, one));
  CHECK(!BRANCHES("nae", one, one) && !BRANCHES("nbe", one, one) && !BRANCHES("nge", one, one) && !BRANCHES("nle", one, one));
  printf("%s, %d wrong\n", checks == 13 ? "every check made" : "checks are missing", wrong);
  return wrong != 0;
}
