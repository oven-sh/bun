// A loop that waits for another thread by loading an atomic object, with any memory order, the relaxed one too,
// performs the load every time round: it ends once the other thread has stored. (A compiler that treats the relaxed
// load as an ordinary one reads it once, before the loop, and the loop never ends.)
//
// Every kind of wait is gone through fifty times, and each time the value it waits for is stored only after it has
// begun: this thread asks for the store through a mutex and a condition variable (which are not what is being tested)
// and starts to spin at once, long before the other thread has woken up. A load made once before the loop therefore
// sees the old value every time. Each wait gives up after a very large number of tries, so that a failure is a line
// that says 0 and not a hang.
#include <pthread.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define LIMIT 2000000000ull
enum { ROUNDS = 50 };

static atomic_bool flag_bool;
static _Atomic unsigned char flag_8;
static _Atomic unsigned short flag_16;
static atomic_int flag_32;
static _Atomic long long flag_64;
static _Atomic(int *) flag_pointer;
static atomic_flag flag_flag = ATOMIC_FLAG_INIT;
static volatile int flag_volatile;
static int flag_plain;
static struct { int before; atomic_int member; int after; } in_a_structure;
static volatile struct { unsigned other : 5; unsigned field : 9; } bit_fields;
static int targets[ROUNDS + 1];

// What this thread asks of the other: "store `wanted` the way `asked` says". 0 when nothing is asked.
static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t changed = PTHREAD_COND_INITIALIZER;
static int asked, wanted, finished;

enum { BOOL = 1, BITS_8, BITS_16, BITS_32, BITS_64, POINTER, FLAG, VOLATILE, PLAIN, MEMBER, BIT_FIELD };

static void *the_other_thread(void *argument) {
  pthread_mutex_lock(&mutex);
  for (;;) {
    while (!asked && !finished) pthread_cond_wait(&changed, &mutex);
    if (finished) break;
    int how = asked, value = wanted;
    asked = 0;
    switch (how) {
      case BOOL: atomic_store_explicit(&flag_bool, value & 1, memory_order_relaxed); break;
      case BITS_8: atomic_store_explicit(&flag_8, (unsigned char)value, memory_order_relaxed); break;
      case BITS_16: atomic_store_explicit(&flag_16, (unsigned short)value, memory_order_relaxed); break;
      case BITS_32: atomic_store_explicit(&flag_32, value, memory_order_relaxed); break;
      case BITS_64: atomic_store_explicit(&flag_64, value, memory_order_relaxed); break;
      case POINTER: atomic_store_explicit(&flag_pointer, &targets[value], memory_order_relaxed); break;
      case FLAG: atomic_flag_clear_explicit(&flag_flag, memory_order_relaxed); break;
      case VOLATILE: flag_volatile = value; break;
      case PLAIN: __atomic_store_n(&flag_plain, value, __ATOMIC_RELAXED); break;
      case MEMBER: atomic_store_explicit(&in_a_structure.member, value, memory_order_relaxed); break;
      case BIT_FIELD: bit_fields.field = (unsigned)value; break;
    }
  }
  pthread_mutex_unlock(&mutex);
  return argument;
}

static void ask(int how, int value) {
  pthread_mutex_lock(&mutex);
  asked = how;
  wanted = value;
  pthread_cond_signal(&changed);
  pthread_mutex_unlock(&mutex);
}

// A wait that goes on while `condition` holds; `round` is the value waited for.
#define WAIT_WHILE(name, condition)                        \
  __attribute__((noinline)) static int name(int round) {   \
    unsigned long long tries = 0;                          \
    while (condition)                                      \
      if (++tries == LIMIT) return 0;                      \
    return 1;                                              \
  }
WAIT_WHILE(wait_bool, atomic_load_explicit(&flag_bool, memory_order_relaxed) != (round & 1))
WAIT_WHILE(wait_8, atomic_load_explicit(&flag_8, memory_order_relaxed) != round)
WAIT_WHILE(wait_16, atomic_load_explicit(&flag_16, memory_order_relaxed) != round)
WAIT_WHILE(wait_32, atomic_load_explicit(&flag_32, memory_order_relaxed) != round)
WAIT_WHILE(wait_64, atomic_load_explicit(&flag_64, memory_order_relaxed) != round)
WAIT_WHILE(wait_pointer, atomic_load_explicit(&flag_pointer, memory_order_relaxed) != &targets[round])
WAIT_WHILE(wait_consume, atomic_load_explicit(&flag_32, memory_order_consume) != round)
WAIT_WHILE(wait_acquire, atomic_load_explicit(&flag_32, memory_order_acquire) != round)
WAIT_WHILE(wait_sequentially_consistent, atomic_load(&flag_32) != round)
WAIT_WHILE(wait_plain_use_of_an_atomic, flag_32 != round)
WAIT_WHILE(wait_flag, atomic_flag_test_and_set_explicit(&flag_flag, memory_order_relaxed))
WAIT_WHILE(wait_volatile, flag_volatile != round)
WAIT_WHILE(wait_builtin, __atomic_load_n(&flag_plain, __ATOMIC_RELAXED) != round)
WAIT_WHILE(wait_member, atomic_load_explicit(&in_a_structure.member, memory_order_relaxed) != round)
WAIT_WHILE(wait_bit_field, bit_fields.field != (unsigned)round)

// The other shapes a wait takes.
__attribute__((noinline)) static int wait_do_while(int round) {
  unsigned long long tries = 0;
  do {
    if (++tries == LIMIT) return 0;
  } while (atomic_load_explicit(&flag_32, memory_order_relaxed) != round);
  return 1;
}
__attribute__((noinline)) static int wait_for_with_break(int round) {
  for (unsigned long long tries = 0; tries < LIMIT; tries++) {
    if (atomic_load_explicit(&flag_32, memory_order_relaxed) == round) return 1;
  }
  return 0;
}
__attribute__((noinline)) static int wait_with_a_compiler_barrier(int round) {
  unsigned long long tries = 0;
  while (__atomic_load_n(&flag_plain, __ATOMIC_RELAXED) != round) {
    __asm__ volatile("" ::: "memory");
    if (++tries == LIMIT) return 0;
  }
  return 1;
}
static int counter;
__attribute__((noinline)) static int wait_counting_in_memory(int round) {
  unsigned long long tries = 0;
  while (atomic_load_explicit(&flag_32, memory_order_relaxed) != round) {
    if (++counter < 0) counter = 0;
    if (++tries == LIMIT) return 0;
  }
  return 1;
}
__attribute__((pure, noinline)) static int twice(int x) { return x * 2; }
__attribute__((noinline)) static int wait_with_a_pure_call_in_the_body(int round) {
  unsigned long long tries = 0;
  int sum = 0;
  while (atomic_load_explicit(&flag_32, memory_order_relaxed) != round) {
    sum += twice(round);
    if (++tries == LIMIT) return 0;
  }
  return 1 + (sum & 0);
}
__attribute__((noinline)) static int wait_through_a_parameter(_Atomic long long *flag, int round) {
  unsigned long long tries = 0;
  while (atomic_load_explicit(flag, memory_order_relaxed) != round)
    if (++tries == LIMIT) return 0;
  return 1;
}
static int wait_64_through_a_parameter(int round) { return wait_through_a_parameter(&flag_64, round); }
// (Not kept out of line: the loop ends up in `every_round`, among other code.)
static inline int wait_inlined(int round) {
  unsigned long long tries = 0;
  while (atomic_load_explicit(&flag_16, memory_order_relaxed) != round)
    if (++tries == LIMIT) return 0;
  return 1;
}

// Fifty rounds of one kind of wait: 1 if every one of them ended because the store was seen.
static int every_round(int how, int (*wait)(int)) {
  for (int round = 1; round <= ROUNDS; round++) {
    ask(how, round);
    if (!wait(round)) return 0;
  }
  return 1;
}

int main(void) {
  atomic_flag_test_and_set(&flag_flag);
  pthread_t thread;
  pthread_create(&thread, 0, the_other_thread, 0);
  printf("bool %d\n", every_round(BOOL, wait_bool));
  printf("8 bits %d\n", every_round(BITS_8, wait_8));
  printf("16 bits %d\n", every_round(BITS_16, wait_16));
  printf("32 bits %d\n", every_round(BITS_32, wait_32));
  printf("64 bits %d\n", every_round(BITS_64, wait_64));
  printf("pointer %d\n", every_round(POINTER, wait_pointer));
  atomic_store(&flag_32, 0);
  printf("consume %d\n", every_round(BITS_32, wait_consume));
  atomic_store(&flag_32, 0);
  printf("acquire %d\n", every_round(BITS_32, wait_acquire));
  atomic_store(&flag_32, 0);
  printf("sequentially consistent %d\n", every_round(BITS_32, wait_sequentially_consistent));
  atomic_store(&flag_32, 0);
  printf("plain use of an atomic object %d\n", every_round(BITS_32, wait_plain_use_of_an_atomic));
  printf("atomic_flag %d\n", every_round(FLAG, wait_flag));
  printf("volatile %d\n", every_round(VOLATILE, wait_volatile));
  printf("__atomic_load_n %d\n", every_round(PLAIN, wait_builtin));
  printf("a member of a structure %d\n", every_round(MEMBER, wait_member));
  printf("a volatile bit-field %d\n", every_round(BIT_FIELD, wait_bit_field));
  atomic_store(&flag_32, 0);
  printf("do while %d\n", every_round(BITS_32, wait_do_while));
  atomic_store(&flag_32, 0);
  printf("for with break %d\n", every_round(BITS_32, wait_for_with_break));
  __atomic_store_n(&flag_plain, 0, __ATOMIC_RELAXED);
  printf("with a compiler barrier %d\n", every_round(PLAIN, wait_with_a_compiler_barrier));
  atomic_store(&flag_32, 0);
  printf("counting in memory %d\n", every_round(BITS_32, wait_counting_in_memory));
  atomic_store(&flag_32, 0);
  printf("with a call of a pure function in the body %d\n", every_round(BITS_32, wait_with_a_pure_call_in_the_body));
  atomic_store(&flag_64, 0);
  printf("through a pointer parameter %d\n", every_round(BITS_64, wait_64_through_a_parameter));
  atomic_store(&flag_16, 0);
  printf("inlined %d\n", every_round(BITS_16, wait_inlined));
  pthread_mutex_lock(&mutex);
  finished = 1;
  pthread_cond_signal(&changed);
  pthread_mutex_unlock(&mutex);
  pthread_join(thread, 0);
  return 0;
}
