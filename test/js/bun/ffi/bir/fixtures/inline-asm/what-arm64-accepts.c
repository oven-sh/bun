// On arm64 there is no assembler: the statements that mean the same to every processor are what is accepted: an
// empty template that only ties values to registers or memory, the hints, the barriers, and alignment directives.
#include <stdio.h>

static unsigned long hide(unsigned long value) { __asm__("" : "+r"(value)); return value; }
static int through_memory(int *p) { __asm__ volatile("" : "+m"(*p) : : "memory"); return *p; }
static int copy(int from) { int to; __asm__ volatile("" : "=r"(to) : "0"(from)); return to; }

int main(void) {
  int shared = 5;
  __asm__ volatile("yield");
  __asm__ volatile("nop");
  __asm__ volatile("isb" ::: "memory");
  __asm__ volatile("dmb ish" ::: "memory");
  __asm__ volatile("dmb ishst" ::: "memory");
  __asm__ volatile("dmb ishld" ::: "memory");
  __asm__ volatile("dmb sy" ::: "memory");
  __asm__ volatile("" ::: "memory");
  __asm__(".p2align 4");
  printf("%lu %d %d\n", hide(42), through_memory(&shared), copy(7));
  if (shared > 1000) __asm__ volatile("brk #1");
  return 0;
}
