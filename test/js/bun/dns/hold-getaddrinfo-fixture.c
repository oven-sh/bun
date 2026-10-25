// LD_PRELOAD shim for the "gives up on a running lookup" test in
// dns-prefetch.test.ts: the first getaddrinfo(3) of the name in HOLD_DNS_NAME
// creates the file named by HOLD_DNS_SIGNAL_FILE as its hold begins, then
// blocks for HOLD_DNS_MS milliseconds; every call for that name answers as
// 127.0.0.1. Other names pass through to libc.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <netdb.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int (*real_getaddrinfo)(const char *, const char *, const struct addrinfo *, struct addrinfo **);
static pthread_once_t resolve_once = PTHREAD_ONCE_INIT;

static void resolve_real(void) { real_getaddrinfo = dlsym(RTLD_NEXT, "getaddrinfo"); }

int getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res) {
  static int calls;
  pthread_once(&resolve_once, resolve_real);
  const char *name = getenv("HOLD_DNS_NAME");
  if (node && name && strcmp(node, name) == 0) {
    if (__sync_fetch_and_add(&calls, 1) == 0) {
      const char *signal = getenv("HOLD_DNS_SIGNAL_FILE");
      if (signal) close(open(signal, O_WRONLY | O_CREAT, 0644));
      long ms = atol(getenv("HOLD_DNS_MS") ? getenv("HOLD_DNS_MS") : "0");
      struct timespec left = {.tv_sec = ms / 1000, .tv_nsec = (ms % 1000) * 1000000L};
      while (nanosleep(&left, &left) != 0) {
      }
    }
    node = "127.0.0.1";
  }
  return real_getaddrinfo(node, service, hints, res);
}
