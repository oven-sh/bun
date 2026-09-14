// An "m" operand tells the compiler that the statement reads that object (or writes it, "=m", or both, "+m"), where it
// stands: an `asm` that is not volatile and has only an "m" input is still not something to take out of a loop that
// stores to the object, or to perform once for two. Linux's test_bit in the condition of a loop that sets the bit a few
// times round (bounded: it says so if it gives up), the same in the body of a do-while and in a for with a break, between
// two stores in a straight line; an object that is a global, a local, `*p`, an element, a member; and a "memory"
// clobber as a barrier between two ordinary stores that a signal handler looks at.
#include <signal.h>
#include <stdio.h>

#define NOINLINE __attribute__((noinline))
static inline int test_bit(const unsigned long *address, long number) {
  int result;
  __asm__("btq %2, %1\n\tsbbl %0, %0" : "=r"(result) : "m"(*address), "r"(number) : "cc");
  return result;
}
static inline int load(const int *p) { int r; __asm__("movl %1, %0" : "=r"(r) : "m"(*p)); return r; }
static inline void store(int *p, int v) { __asm__("movl %1, %0" : "=m"(*p) : "r"(v)); }
static inline void increment(int *p) { __asm__("incl %0" : "+m"(*p)); }

static unsigned long word;
static int global;
struct holder { int before, member, after; };
#define LIMIT 2000000000ull

// The loop that waits for the bit is the one that sets it, a few times round: the statement in its condition reads
// the word each time. (Bounded: it says so if it gives up.)
NOINLINE static int waits_for_the_bit(const unsigned long *w) {
  unsigned long long spins = 0;
  while (!test_bit(w, 5)) {
    if (++spins == LIMIT) break;
    if (spins > 5) word |= 1ul << 5;
  }
  return spins < LIMIT ? (int)spins : -1;
}
NOINLINE static int counts_in_a_loop(void) {
  int count = 0;
  for (int i = 0; i < 8; i++) {
    word = 1ul << i;
    count += test_bit(&word, 3) ? 1 : 0;
  }
  return count;
}
NOINLINE static long in_a_do_while(int *x, int n) {
  long sum = 0;
  int i = 0;
  do {
    *x = i;
    sum += load(x);
    i++;
  } while (i < n);
  return sum;
}
NOINLINE static long in_a_for_with_a_break(int *x) {
  long sum = 0;
  for (int i = 0;; i++) {
    *x = i * 2;
    if (load(x) > 12) break;
    sum += load(x);
  }
  return sum;
}
NOINLINE static long between_two_stores(int *x) {
  *x = 1;
  int first = load(x);
  *x = 2;
  int second = load(x);
  return first * 10 + second;
}
NOINLINE static long of_every_kind(int *p, int i) {
  int local = 3, array[4] = { 0, 0, 0, 0 };
  struct holder held = { 1, 2, 3 };
  global = 4;
  long seen = load(&global);
  local += 2;
  seen = seen * 10 + load(&local);
  *p = 6;
  seen = seen * 10 + load(p);
  array[i] = 7;
  seen = seen * 10 + load(&array[i]);
  held.member = 8;
  return seen * 10 + load(&held.member);
}
NOINLINE static long written_and_both(int *x) {
  int local = 7;
  *x = 1;
  store(x, 5);
  long seen = *x;
  increment(x);
  increment(x);
  seen = seen * 10 + *x;
  store(&local, 9);
  seen = seen * 10 + local;
  increment(&local);
  return seen * 100 + local;
}
// (A result nobody uses may be dropped, and the statement with it; a volatile one may not.)
NOINLINE static int unused_and_volatile(int *x) {
  *x = 3;
  (void)load(x);
  int r;
  __asm__ volatile("movl %1, %0" : "=r"(r) : "m"(*x));
  *x = 4;
  return r;
}

static int first_store, second_store;
static volatile sig_atomic_t seen_by_the_handler;
static void looks(int signal_number) { (void)signal_number; seen_by_the_handler = first_store * 10 + second_store; }
NOINLINE static int a_barrier_between_two_stores(void) {
  first_store = 1;
  __asm__ volatile("" ::: "memory");
  raise(SIGUSR1);
  second_store = 2;
  __asm__ volatile("" ::: "memory");
  first_store = 3;
  return seen_by_the_handler;
}

int main(void) {
  int x = 0;
  signal(SIGUSR1, looks);
  word = 0;
  printf("%d\n", waits_for_the_bit(&word));
  printf("%d\n", counts_in_a_loop());
  printf("%ld %ld %ld\n", in_a_do_while(&x, 10), in_a_for_with_a_break(&x), between_two_stores(&x));
  printf("%ld\n", of_every_kind(&x, 2));
  printf("%ld\n", written_and_both(&x));
  printf("%d\n", unused_and_volatile(&x));
  printf("%d\n", a_barrier_between_two_stores());
  return 0;
}
