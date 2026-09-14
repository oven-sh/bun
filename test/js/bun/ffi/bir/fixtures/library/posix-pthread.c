// POSIX <pthread.h>: the library starts a function written in C on a new thread and hands back the pointer it
// returns; mutexes; a thread-specific key with a destructor; _Thread_local objects.
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>

enum { THREADS = 4, ROUNDS = 20000 };
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_once_t once = PTHREAD_ONCE_INIT;
static pthread_key_t key;
static long long shared;
static int initialized, destroyed;
static _Thread_local int mine = 100;

static void initialize(void) { initialized++; }
static void destroy(void *value) { pthread_mutex_lock(&lock); destroyed += value != 0; pthread_mutex_unlock(&lock); }

static void *worker(void *argument) {
  intptr_t id = (intptr_t)argument;
  pthread_once(&once, initialize);
  pthread_setspecific(key, argument);
  mine += (int)id;
  for (int i = 0; i < ROUNDS; i++) {
    pthread_mutex_lock(&lock);
    shared += id;
    pthread_mutex_unlock(&lock);
  }
  return (void *)(intptr_t)(mine * 10 + (pthread_getspecific(key) == argument));
}

int main(void) {
  pthread_key_create(&key, destroy);
  pthread_t threads[THREADS];
  for (intptr_t i = 0; i < THREADS; i++)
    if (pthread_create(&threads[i], 0, worker, (void *)(i + 1)) != 0) return 1;
  for (int i = 0; i < THREADS; i++) {
    void *result = 0;
    pthread_join(threads[i], &result);
    printf("%d ", (int)(intptr_t)result);
  }
  printf("\n%lld %d %d %d %d\n", shared, initialized, mine, destroyed, pthread_equal(pthread_self(), pthread_self()) != 0);
  return 0;
}
