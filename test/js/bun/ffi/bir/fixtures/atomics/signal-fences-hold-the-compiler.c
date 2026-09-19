// C11 7.17.4.2: `atomic_signal_fence` orders what the compiler does as `atomic_thread_fence` does, without an
// instruction. So a loop that polls an ordinary object around one sees a signal handler's store, and two reads of one
// object on either side of one are two reads. Every wait is bounded and says so if it runs out.
#include <signal.h>
#include <stdatomic.h>
#include <stdio.h>
#include <sys/time.h>

static int plain;
static volatile sig_atomic_t for_signals;
static atomic_int atomic;
static int payload;

static void handler(int signal_number) {
  (void)signal_number;
  plain++;
  for_signals = 1;
  payload = 42;
  atomic_signal_fence(memory_order_release);
  atomic_store_explicit(&atomic, 1, memory_order_relaxed);
}

#define LIMIT 2000000000ull
// The handler runs on this thread a moment after the loop has begun, and nothing in the loop is a call, which would
// hold the compiler by itself.
static void in_a_moment(void) {
  struct itimerval moment = { { 0, 0 }, { 0, 2000 } };
  setitimer(ITIMER_REAL, &moment, 0);
}
#define WAIT_FOR(condition, fence) ({ \
    unsigned long long spins = 0; \
    int seen = 0; \
    in_a_moment(); \
    while (spins < LIMIT) { \
      if (condition) { seen = 1; break; } \
      fence; \
      spins++; \
    } \
    seen; })

__attribute__((noinline)) static int two_reads(void) {
  int before = plain;
  raise(SIGUSR1);
  atomic_signal_fence(memory_order_seq_cst);
  return plain - before;
}

int main(void) {
  signal(SIGUSR1, handler);
  signal(SIGALRM, handler);
  plain = 0;
  printf("sequentially consistent %d\n", WAIT_FOR(plain != 0, atomic_signal_fence(memory_order_seq_cst)));
  plain = 0;
  printf("acquire %d\n", WAIT_FOR(plain != 0, atomic_signal_fence(memory_order_acquire)));
  plain = 0;
  printf("acquire and release %d\n", WAIT_FOR(plain != 0, atomic_signal_fence(memory_order_acq_rel)));
  plain = 0;
  printf("__atomic_signal_fence %d\n", WAIT_FOR(plain != 0, __atomic_signal_fence(__ATOMIC_SEQ_CST)));
  plain = 0;
  printf("an empty asm with a memory clobber %d\n", WAIT_FOR(plain != 0, __asm__ volatile("" ::: "memory")));
  for_signals = 0;
  printf("volatile sig_atomic_t, no fence %d\n", WAIT_FOR(for_signals != 0, (void)0));
  atomic_store(&atomic, 0);
  payload = 0;
  int seen = WAIT_FOR(atomic_load_explicit(&atomic, memory_order_relaxed) != 0, (void)0);
  atomic_signal_fence(memory_order_acquire);
  printf("a relaxed atomic, then what was stored before it %d %d\n", seen, payload);
  printf("two reads around a fence %d\n", two_reads());
  return 0;
}
