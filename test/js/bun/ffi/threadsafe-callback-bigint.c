#include <stdint.h>
#include <stdlib.h>

#ifdef _WIN32
#define FFI_EXPORT __declspec(dllexport)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#define FFI_EXPORT __attribute__((visibility("default")))
#include <pthread.h>
#endif

typedef void (*cb_i64_t)(int64_t);
typedef void (*cb_u64_t)(uint64_t);
typedef void (*cb_mixed_t)(int32_t, int64_t, uint64_t, double);

struct i64_args { cb_i64_t cb; int64_t value; int32_t count; };
struct u64_args { cb_u64_t cb; uint64_t value; int32_t count; };
struct mixed_args { cb_mixed_t cb; int32_t count; };

#ifdef _WIN32
#define THREAD_T HANDLE
#define THREAD_RETURN DWORD WINAPI
#define THREAD_RETVAL 0
#define THREAD_CREATE(t, fn, arg) ((t) = CreateThread(NULL, 0, fn, arg, 0, NULL))
#define THREAD_JOIN(t) do { WaitForSingleObject((t), INFINITE); CloseHandle((t)); } while (0)
#else
#define THREAD_T pthread_t
#define THREAD_RETURN void *
#define THREAD_RETVAL NULL
#define THREAD_CREATE(t, fn, arg) pthread_create(&(t), NULL, fn, arg)
#define THREAD_JOIN(t) pthread_join((t), NULL)
#endif

static THREAD_RETURN worker_i64(void *p)
{
  struct i64_args *a = (struct i64_args *)p;
  for (int32_t i = 0; i < a->count; i++) a->cb(a->value);
  return THREAD_RETVAL;
}

static THREAD_RETURN worker_u64(void *p)
{
  struct u64_args *a = (struct u64_args *)p;
  for (int32_t i = 0; i < a->count; i++) a->cb(a->value);
  return THREAD_RETVAL;
}

static THREAD_RETURN worker_mixed(void *p)
{
  struct mixed_args *a = (struct mixed_args *)p;
  for (int32_t i = 0; i < a->count; i++) {
    // values chosen so that the 64-bit args require JSBigInt
    a->cb(42, (int64_t)-9007199254740993LL, (uint64_t)18446744073709551615ULL, 3.5);
  }
  return THREAD_RETVAL;
}

// Invoke a threadsafe JSCallback taking an int64_t from a real OS thread.
// Blocks until the thread has finished, so by the time this returns all
// callback invocations have at least been posted to the JS thread's queue.
FFI_EXPORT void call_i64_from_thread(cb_i64_t cb, int64_t value, int32_t count)
{
  struct i64_args args = { cb, value, count };
  THREAD_T t;
  THREAD_CREATE(t, worker_i64, &args);
  THREAD_JOIN(t);
}

FFI_EXPORT void call_u64_from_thread(cb_u64_t cb, uint64_t value, int32_t count)
{
  struct u64_args args = { cb, value, count };
  THREAD_T t;
  THREAD_CREATE(t, worker_u64, &args);
  THREAD_JOIN(t);
}

FFI_EXPORT void call_mixed_from_thread(cb_mixed_t cb, int32_t count)
{
  struct mixed_args args = { cb, count };
  THREAD_T t;
  THREAD_CREATE(t, worker_mixed, &args);
  THREAD_JOIN(t);
}
