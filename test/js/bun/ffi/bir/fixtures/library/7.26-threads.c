// C11 7.26 <threads.h>: the library starts a function written in C on a new thread, with its argument, and hands
// its result back; mutexes, condition variables, call_once, thread-specific storage and _Thread_local objects.
#include <stdio.h>
#include <threads.h>

enum { THREADS = 4, ROUNDS = 20000 };
static mtx_t lock;
static cnd_t all_arrived;
static long long shared;
static int arrived;
static once_flag once = ONCE_FLAG_INIT;
static int initialized;
static tss_t slot;
static _Atomic int destroyed; // written by every thread as it ends, and two can end at once
static _Thread_local int mine = 100;

static void initialize(void) { initialized++; }
static void destroy(void *value) { destroyed += *(int *)value > 0; }

static int worker(void *argument) {
  int id = *(int *)argument;
  call_once(&once, initialize);
  mine += id;                                   // each thread has its own, starting from the initializer
  tss_set(slot, argument);
  for (int i = 0; i < ROUNDS; i++) {
    mtx_lock(&lock);
    shared += id;
    mtx_unlock(&lock);
  }
  mtx_lock(&lock);
  arrived++;
  if (arrived == THREADS) cnd_broadcast(&all_arrived);
  while (arrived < THREADS) cnd_wait(&all_arrived, &lock);
  mtx_unlock(&lock);
  return mine * 10 + (tss_get(slot) == argument);
}

int main(void) {
  printf("%d %d %d\n", mtx_init(&lock, mtx_plain) == thrd_success, cnd_init(&all_arrived) == thrd_success, tss_create(&slot, destroy) == thrd_success);
  thrd_t threads[THREADS];
  int ids[THREADS];
  for (int i = 0; i < THREADS; i++) {
    ids[i] = i + 1;
    if (thrd_create(&threads[i], worker, &ids[i]) != thrd_success) return 1;
  }
  for (int i = 0; i < THREADS; i++) {
    int result = -1;
    thrd_join(threads[i], &result);
    printf("%d ", result);
  }
  printf("\n%lld %d %d %d %d\n", shared, initialized, mine, destroyed, thrd_equal(thrd_current(), thrd_current()) != 0);
  mtx_destroy(&lock); cnd_destroy(&all_arrived); tss_delete(slot);
  return 0;
}
