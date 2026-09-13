/* Extended asm that needs an assembler: the instructions are encoded at compile time and run
   with their operands in the registers the constraints name. */
#include <stdio.h>
#include <stdint.h>

/* zstd: a conditional move the optimizer must not turn back into a branch. */
static const unsigned char *select_address(uint32_t index, uint32_t low_limit, const unsigned char *candidate, const unsigned char *backup) {
  __asm__("cmp %1, %2\n cmova %3, %0" : "+r"(candidate) : "r"(index), "r"(low_limit), "r"(backup));
  return candidate;
}
static uint64_t multiply_high(uint64_t a, uint64_t b, uint64_t *low) {
  uint64_t high;
  __asm__("mulq %3" : "=a"(*low), "=d"(high) : "a"(a), "rm"(b));
  return high;
}
static uint32_t swap32(uint32_t v) { __asm__("bswap %0" : "+r"(v)); return v; }
static uint64_t swap64(uint64_t v) { __asm__("bswapq %0" : "+r"(v)); return v; }
static uint64_t ticks(void) { uint32_t lo, hi; __asm__ volatile("rdtsc" : "=a"(lo), "=d"(hi)); return ((uint64_t)hi << 32) | lo; }
static void *thread_pointer(void) { void *self; __asm__("movq %%fs:0, %0" : "=r"(self)); return self; }
static int fetch_add(int *counter, int by) { __asm__ volatile("lock xaddl %0, %1" : "+r"(by), "+m"(*counter) : : "memory"); return by; }
static int add_carries(uint32_t a, uint32_t b) { unsigned char carry; __asm__("addl %2, %1\n setc %0" : "=q"(carry), "+r"(a) : "r"(b)); return carry; }
static uint64_t sum_below(uint64_t n) {
  uint64_t total = 0;
  __asm__("1:\n test %1, %1\n jz 2f\n dec %1\n add %1, %0\n jmp 1b\n2:" : "+r"(total), "+r"(n));
  return total;
}

static _Thread_local int in_this_thread = 7;

int main(void) {
  unsigned char a = 'a', b = 'b';
  printf("cmova %c %c\n", *select_address(3, 5, &a, &b), *select_address(5, 3, &a, &b));
  uint64_t low, high = multiply_high(0xfedcba9876543210ull, 0x123456789abcdef1ull, &low);
  printf("mulq %016llx %016llx\n", (unsigned long long)high, (unsigned long long)low);
  printf("bswap %08x %016llx\n", swap32(0x11223344), (unsigned long long)swap64(0x1122334455667788ull));
  uint64_t before = ticks(), after = ticks();
  printf("rdtsc %d\n", before != 0 && after >= before);
  /* On x86-64 Linux the word at %fs:0 is the thread pointer itself, and thread-local objects
     sit below it. */
  void *self = thread_pointer();
  printf("fs %d %d\n", *(void **)self == self, (char *)&in_this_thread < (char *)self);
  int counter = 40;
  int old = fetch_add(&counter, 2);
  printf("xadd %d %d\n", old, counter);
  printf("setc %d %d\n", add_carries(0xffffffffu, 1), add_carries(1, 2));
  printf("loop %llu\n", (unsigned long long)sum_below(10));
  return 0;
}
