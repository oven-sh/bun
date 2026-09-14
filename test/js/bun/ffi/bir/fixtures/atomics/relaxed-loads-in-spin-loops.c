// A loop that waits for another thread by loading an atomic object, with any memory order, the relaxed one too,
// performs the load every time round: it ends once the other thread has stored. (A compiler that treats the
// relaxed load as an ordinary one reads it once, before the loop, and the loop never ends.) Each shape of loop
// gives up after a very large number of tries, so that a failure is a line of output and not a hang.
#include <pthread.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define LIMIT 4000000000ull

static atomic_bool flag_bool;
static _Atomic unsigned char flag_8;
static _Atomic unsigned short flag_16;
static atomic_int flag_32;
static _Atomic long long flag_64;
static _Atomic(int *) flag_pointer;
static atomic_flag flag_flag = ATOMIC_FLAG_INIT;
static volatile int flag_volatile;
static int flag_plain;
static atomic_int started;
static int target;

static void *setter(void *argument) {
  // Wait until the other thread is in its loop (or about to be), then store to all of them.
  while (!atomic_load_explicit(&started, memory_order_acquire)) {
  }
  atomic_store_explicit(&flag_bool, true, memory_order_relaxed);
  atomic_store_explicit(&flag_8, 1, memory_order_relaxed);
  atomic_store_explicit(&flag_16, 1, memory_order_relaxed);
  atomic_store_explicit(&flag_32, 1, memory_order_relaxed);
  atomic_store_explicit(&flag_64, 1, memory_order_relaxed);
  atomic_store_explicit(&flag_pointer, &target, memory_order_relaxed);
  atomic_flag_clear_explicit(&flag_flag, memory_order_relaxed);
  flag_volatile = 1;
  __atomic_store_n(&flag_plain, 1, __ATOMIC_RELAXED);
  return argument;
}

#define WAIT_WHILE(name, condition)                                  \
  __attribute__((noinline)) static int name(void) {                  \
    unsigned long long tries = 0;                                    \
    while (condition)                                                \
      if (++tries == LIMIT) return 0;                                \
    return 1;                                                        \
  }
WAIT_WHILE(wait_bool, !atomic_load_explicit(&flag_bool, memory_order_relaxed))
WAIT_WHILE(wait_8, !atomic_load_explicit(&flag_8, memory_order_relaxed))
WAIT_WHILE(wait_16, !atomic_load_explicit(&flag_16, memory_order_relaxed))
WAIT_WHILE(wait_32, !atomic_load_explicit(&flag_32, memory_order_relaxed))
WAIT_WHILE(wait_64, !atomic_load_explicit(&flag_64, memory_order_relaxed))
WAIT_WHILE(wait_pointer, atomic_load_explicit(&flag_pointer, memory_order_relaxed) != &target)
WAIT_WHILE(wait_acquire, !atomic_load_explicit(&flag_32, memory_order_acquire))
WAIT_WHILE(wait_sequentially_consistent, !atomic_load(&flag_32))
WAIT_WHILE(wait_plain_use_of_an_atomic, !flag_32)
WAIT_WHILE(wait_flag, atomic_flag_test_and_set_explicit(&flag_flag, memory_order_relaxed))
WAIT_WHILE(wait_volatile, !flag_volatile)
WAIT_WHILE(wait_builtin, !__atomic_load_n(&flag_plain, __ATOMIC_RELAXED))

// The other shapes a wait takes.
__attribute__((noinline)) static int wait_do_while(void) {
  unsigned long long tries = 0;
  do {
    if (++tries == LIMIT) return 0;
  } while (!atomic_load_explicit(&flag_32, memory_order_relaxed));
  return 1;
}
__attribute__((noinline)) static int wait_for_with_break(void) {
  for (unsigned long long tries = 0; tries < LIMIT; tries++) {
    if (atomic_load_explicit(&flag_32, memory_order_relaxed)) return 1;
  }
  return 0;
}
__attribute__((noinline)) static int wait_with_a_compiler_barrier(void) {
  unsigned long long tries = 0;
  while (!__atomic_load_n(&flag_plain, __ATOMIC_RELAXED)) {
    __asm__ volatile("" ::: "memory");
    if (++tries == LIMIT) return 0;
  }
  return 1;
}
__attribute__((noinline)) static int wait_counting_in_memory(int *counter) {
  while (!atomic_load_explicit(&flag_32, memory_order_relaxed))
    if (++*counter < 0) *counter = 0;
  return 1;
}

int main(void) {
  atomic_flag_test_and_set(&flag_flag);
  pthread_t thread;
  pthread_create(&thread, 0, setter, 0);
  atomic_store_explicit(&started, 1, memory_order_release);
  printf("bool %d\n", wait_bool());
  printf("8 bits %d\n", wait_8());
  printf("16 bits %d\n", wait_16());
  printf("32 bits %d\n", wait_32());
  printf("64 bits %d\n", wait_64());
  printf("pointer %d\n", wait_pointer());
  printf("acquire %d\n", wait_acquire());
  printf("sequentially consistent %d\n", wait_sequentially_consistent());
  printf("plain use of an atomic object %d\n", wait_plain_use_of_an_atomic());
  printf("atomic_flag %d\n", wait_flag());
  printf("volatile %d\n", wait_volatile());
  printf("__atomic_load_n %d\n", wait_builtin());
  printf("do while %d\n", wait_do_while());
  printf("for with break %d\n", wait_for_with_break());
  printf("with a compiler barrier %d\n", wait_with_a_compiler_barrier());
  int counter = 0;
  printf("counting in memory %d\n", wait_counting_in_memory(&counter));
  pthread_join(thread, 0);
  return 0;
}
