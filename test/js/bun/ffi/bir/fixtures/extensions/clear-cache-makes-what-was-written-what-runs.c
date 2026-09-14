// `__builtin___clear_cache(start, end)`: instructions written as data are what runs there from then on. On AArch64 the
// instruction and data caches do not see each other's contents by themselves, so every program that writes code and
// runs it (a small JIT, a closure built in memory) calls this between the two; Apple's compiler makes
// `sys_icache_invalidate` of it. A function is written into a page, run, written again and run again.
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>

static int calls;
static char *counted(char *p) { calls++; return p; }

int main(void) {
  // mov w0, #n; ret
  static const unsigned one[2] = { 0x52800020u, 0xd65f03c0u }, two[2] = { 0x52800040u, 0xd65f03c0u };
  char *page = mmap(0, 16384, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANON | MAP_JIT, -1, 0);
  if (page == MAP_FAILED) {
    printf("no page to write code into\n");
    return 1;
  }
  int (*function)(void) = (int (*)(void))page;
  pthread_jit_write_protect_np(0);
  memcpy(page, one, sizeof one);
  pthread_jit_write_protect_np(1);
  __builtin___clear_cache(page, page + sizeof one);
  int first = function();
  pthread_jit_write_protect_np(0);
  memcpy(page, two, sizeof two);
  pthread_jit_write_protect_np(1);
  // The operands are evaluated once each.
  __builtin___clear_cache(counted(page), counted(page) + sizeof two);
  int second = function();
  printf("%d %d %d\n", first, second, calls);
  munmap(page, 16384);
  return 0;
}
