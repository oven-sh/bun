// `__builtin___memcpy_chk` with an object size that is known and too small for what is copied: the library's
// `__memcpy_chk` ends the program there (glibc says "buffer overflow detected"; Apple's traps), and nothing after it
// runs. (The array is larger than the size it is said to have, so that a copy nobody checked would do no harm and the
// program would end with status 0, which is not what is expected.)
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif

int main(void) {
  // Dying is the point; an image of the process for a debugger is not.
  setrlimit(RLIMIT_CORE, &(struct rlimit){ 0, 0 });
#ifdef __linux__
  prctl(PR_SET_DUMPABLE, 0);
#endif
  char array[64];
  char *volatile holder = array;
  char *destination = holder;
  volatile size_t length = 16, said_to_have = 8; // (values the compiler cannot reason about)
  puts("before the copy");
  fflush(stdout);
  __builtin___memcpy_chk(destination, "0123456789abcdef", length, said_to_have);
  puts("after the copy");
  return 0;
}
