#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <inttypes.h>
#include <math.h>
#include <ctype.h>
#include <errno.h>
#include <assert.h>
#include <limits.h>
#include <float.h>
#include <stdbool.h>
#include <stddef.h>
#include <time.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <signal.h>
#include <setjmp.h>
#if __has_include(<unistd.h>) // POSIX's, which MinGW has some of
#include <unistd.h>
#endif
#if __has_include(<pthread.h>)
#include <pthread.h>
#endif
#include <wchar.h>
#include <locale.h>
int everything(void) { return EOF + (int)sizeof(struct stat) * 0 + (SIGINT == 2); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)everything());
  return 0;
}
