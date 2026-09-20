// A function whose frame is larger than a page touches each page of it on the way down, so that a stack that is too
// small ends at its guard page and not somewhere past it. A thread with a stack of 256 KB calls a function with
// 200 KB of locals, which fits; then one with 1 MB of locals ends the process with the signal a stack overflow is,
// caught here on another stack and reported, where without the probes it would write into whatever lies below.
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

__attribute__((noinline)) static int fits(int seed) {
  volatile char large[200 * 1024];
  large[0] = (char)seed;
  large[sizeof large - 1] = (char)(seed + 1);
  return large[0] + large[sizeof large - 1];
}
__attribute__((noinline)) static int does_not_fit(int seed) {
  volatile char larger[1024 * 1024];
  // Only the far end is written: nothing but a probe touches what is between.
  larger[0] = (char)seed;
  return larger[0];
}
static void *on_a_small_stack(void *argument) {
  // (The handler's stack is each thread's own.)
  static char for_the_handler[64 * 1024];
  stack_t other = { for_the_handler, 0, sizeof for_the_handler };
  sigaltstack(&other, 0);
  int which = *(int *)argument;
  return (void *)(long)(which ? does_not_fit(3) : fits(3));
}
static void overflowed(int signal_number) {
  static const char said[] = "the guard page was reached\n";
  (void)signal_number;
  if (write(1, said, sizeof said - 1) < 0) _exit(3);
  _exit(0);
}

int main(void) {
  struct sigaction action;
  memset(&action, 0, sizeof action);
  action.sa_handler = overflowed;
  action.sa_flags = SA_ONSTACK;
  sigaction(SIGSEGV, &action, 0);
  sigaction(SIGBUS, &action, 0);
  pthread_attr_t attributes;
  pthread_attr_init(&attributes);
  pthread_attr_setstacksize(&attributes, 256 * 1024);
  pthread_t thread;
  void *result;
  int which = 0;
  pthread_create(&thread, &attributes, on_a_small_stack, &which);
  pthread_join(thread, &result);
  printf("%ld\n", (long)result);
  fflush(stdout);
  which = 1;
  pthread_create(&thread, &attributes, on_a_small_stack, &which);
  pthread_join(thread, &result);
  printf("it went on: %ld\n", (long)result);
  return 1;
}
