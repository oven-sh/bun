// LD_PRELOAD shim for dns-pending-abort.test.ts: the first getaddrinfo(3) of the
// name in HOLD_DNS_NAME blocks for HOLD_DNS_MS milliseconds, and every call for
// that name answers as 127.0.0.1. Other names pass through to libc.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <netdb.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

int getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res) {
  static int (*real)(const char *, const char *, const struct addrinfo *, struct addrinfo **);
  static int calls;
  if (!real) real = dlsym(RTLD_NEXT, "getaddrinfo");
  const char *name = getenv("HOLD_DNS_NAME");
  if (node && name && strcmp(node, name) == 0) {
    if (__sync_fetch_and_add(&calls, 1) == 0) {
      long ms = atol(getenv("HOLD_DNS_MS") ? getenv("HOLD_DNS_MS") : "0");
      struct timespec left = {.tv_sec = ms / 1000, .tv_nsec = (ms % 1000) * 1000000L};
      while (nanosleep(&left, &left) != 0) {
      }
    }
    node = "127.0.0.1";
  }
  return real(node, service, hints, res);
}
