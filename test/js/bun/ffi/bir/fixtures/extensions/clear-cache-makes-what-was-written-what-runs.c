// `__builtin___clear_cache(start, end)`: instructions written as data are what runs there from then on. On AArch64 the
// instruction and data caches do not see each other's contents by themselves, so every program that writes code and
// runs it (a small JIT, a closure built in memory) calls this between the two; Apple's compiler makes
// `sys_icache_invalidate` of it. A function is written into a page, the page made executable, the function run; then
// the page is made writable again, another function written over the first, and that one run.
// (Not with MAP_JIT and pthread_jit_write_protect_np: that switch is the thread's, for every such page at once, and
// the code compiled from this file is in one.)
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>

static int calls;
static char *counted(char *p) { calls++; return p; }

int main(void) {
  // mov w0, #n; ret
  static const unsigned one[2] = { 0x52800020u, 0xd65f03c0u }, two[2] = { 0x52800040u, 0xd65f03c0u };
  char *page = mmap(0, 16384, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
  if (page == MAP_FAILED) {
    printf("no page to write code into\n");
    return 1;
  }
  int (*function)(void) = (int (*)(void))page;
  memcpy(page, one, sizeof one);
  if (mprotect(page, 16384, PROT_READ | PROT_EXEC) != 0) {
    printf("the page cannot be made executable\n");
    return 1;
  }
  __builtin___clear_cache(page, page + sizeof one);
  int first = function();
  if (mprotect(page, 16384, PROT_READ | PROT_WRITE) != 0) return 1;
  memcpy(page, two, sizeof two);
  if (mprotect(page, 16384, PROT_READ | PROT_EXEC) != 0) return 1;
  // The operands are evaluated once each.
  __builtin___clear_cache(counted(page), counted(page) + sizeof two);
  int second = function();
  printf("%d %d %d\n", first, second, calls);
  munmap(page, 16384);
  return 0;
}
