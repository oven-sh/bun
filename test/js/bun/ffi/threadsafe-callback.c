#include <stdint.h>
#include <stdlib.h>

#ifdef _WIN32
#define FFI_EXPORT __declspec(dllexport)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#define FFI_EXPORT __attribute__((visibility("default")))
#include <pthread.h>
#include <sched.h>
#endif

typedef void (*callback_t)(int32_t);

#define MAX_THREADS 8

struct worker_args {
  callback_t cb;
  int32_t count;
};

static struct worker_args g_args;
static int g_nthreads = 0;

#ifdef _WIN32
static HANDLE g_threads[MAX_THREADS];
static DWORD WINAPI worker(LPVOID ptr)
#else
static pthread_t g_threads[MAX_THREADS];
static void *worker(void *ptr)
#endif
{
  struct worker_args *args = (struct worker_args *)ptr;
  for (int32_t i = 0; i < args->count; i++) {
    args->cb(i);
#ifndef _WIN32
    // Encourage interleaving with the JS thread so both threads contend on
    // the same HandleSet.
    if ((i & 15) == 0) sched_yield();
#endif
  }
  return 0;
}

// Spawn `nthreads` native threads that each invoke `cb` `count` times.
// Returns immediately so the JS thread can keep running (and allocating)
// while native threads fire callbacks concurrently.
FFI_EXPORT void start_threads(callback_t cb, int32_t count, int32_t nthreads) {
  if (nthreads < 1) nthreads = 1;
  if (nthreads > MAX_THREADS) nthreads = MAX_THREADS;
  g_args.cb = cb;
  g_args.count = count;
  g_nthreads = 0;
  for (int i = 0; i < nthreads; i++) {
#ifdef _WIN32
    HANDLE h = CreateThread(NULL, 0, worker, &g_args, 0, NULL);
    if (h) g_threads[g_nthreads++] = h;
#else
    if (pthread_create(&g_threads[g_nthreads], NULL, worker, &g_args) == 0) {
      g_nthreads++;
    }
#endif
  }
}

// Block until all worker threads have finished. By the time this returns,
// all callback invocations have at least been posted to the JS thread's
// queue.
FFI_EXPORT void join_threads(void) {
  for (int i = 0; i < g_nthreads; i++) {
#ifdef _WIN32
    WaitForSingleObject(g_threads[i], INFINITE);
    CloseHandle(g_threads[i]);
#else
    pthread_join(g_threads[i], NULL);
#endif
  }
  g_nthreads = 0;
}
