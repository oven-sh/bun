// Four threads at once on the same atomic objects: every read-modify-write has to be one (a load, an add and a store
// would lose updates), a compare-and-swap loop has to see the others' stores, and each thread has its own copy of a
// thread-local object. The threads are the platform's own: pthreads, or _beginthreadex on Windows.
#include <stdatomic.h>
#include <stdio.h>

#ifdef _WIN32
#include <process.h>
#include <windows.h>
typedef HANDLE thread_handle;
#define THREAD_RESULT unsigned __stdcall
#define THREAD_RETURN 0
#else
#include <pthread.h>
typedef pthread_t thread_handle;
#define THREAD_RESULT void *
#define THREAD_RETURN 0
#endif

enum { THREADS = 4, ROUNDS = 50000 };

static _Atomic int counter;
static _Atomic long long wide_counter;
static atomic_uchar narrow_counter;
static _Atomic unsigned maximum;
static atomic_flag lock = ATOMIC_FLAG_INIT;
static long long guarded;                 // only touched with the flag held
static int plain_builtin_counter;    // through the __atomic builtins
static _Thread_local int mine = 100; // one per thread, each starting from the initializer
static int seen_by[THREADS];

static THREAD_RESULT work(void *argument) {
  int id = (int)(long long)argument;
  for (int i = 0; i < ROUNDS; i++) {
    counter++;
    atomic_fetch_add_explicit(&wide_counter, 3, memory_order_relaxed);
    narrow_counter += 1;
    __atomic_fetch_add(&plain_builtin_counter, 1, __ATOMIC_SEQ_CST);
    // A maximum by compare-and-swap.
    unsigned candidate = (unsigned)(id * ROUNDS + i), seen = atomic_load(&maximum);
    while (seen < candidate && !atomic_compare_exchange_weak(&maximum, &seen, candidate)) {}
    // A spin lock around an ordinary object.
    while (atomic_flag_test_and_set_explicit(&lock, memory_order_acquire)) {}
    guarded += 2;
    atomic_flag_clear_explicit(&lock, memory_order_release);
    mine++;
  }
  seen_by[id] = mine;
  return THREAD_RETURN;
}

int main(void) {
  thread_handle threads[THREADS];
  for (int i = 0; i < THREADS; i++) {
#ifdef _WIN32
    threads[i] = (HANDLE)_beginthreadex(0, 0, work, (void *)(long long)i, 0, 0);
#else
    pthread_create(&threads[i], 0, work, (void *)(long long)i);
#endif
  }
  for (int i = 0; i < THREADS; i++) {
#ifdef _WIN32
    WaitForSingleObject(threads[i], INFINITE);
    CloseHandle(threads[i]);
#else
    pthread_join(threads[i], 0);
#endif
  }
  printf("%d %lld %d %d\n", counter, (long long)wide_counter, narrow_counter, plain_builtin_counter);
  printf("%u %lld\n", maximum, guarded);
  printf("%d %d %d %d %d\n", seen_by[0], seen_by[1], seen_by[2], seen_by[3], mine);
  return 0;
}
