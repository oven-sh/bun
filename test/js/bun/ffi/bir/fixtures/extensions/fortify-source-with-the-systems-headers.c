// A program built with `_FORTIFY_SOURCE`, as many are: where the system's headers turn memcpy, strcpy, snprintf and the
// rest into their checked forms when they see it (Apple's do; glibc's want `__OPTIMIZE__` too), this is what they
// expand to. Everything here fits, so it all behaves like the plain functions.
#define _FORTIFY_SOURCE 2
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct message { int length; char text[24]; };

static void fill(char *to, size_t size, const char *from) {
  // (The size of what `to` points to is not known here.)
  strncpy(to, from, size - 1);
  to[size - 1] = 0;
}

int main(void) {
  char buffer[32], other[32];
  struct message message;
  char *heap = malloc(40);
  memcpy(buffer, "hello", 6);
  strcpy(other, buffer);
  strcat(other, ", world");
  memmove(other + 1, other, strlen(other) + 1);
  memset(buffer, '-', 5);
  buffer[5] = 0;
  snprintf(message.text, sizeof message.text, "%s [%s]", other, buffer);
  message.length = (int)strlen(message.text);
  sprintf(heap, "%d:%s", message.length, message.text);
  fill(buffer, sizeof buffer, heap);
  strncat(buffer, "!!!", 2);
  printf("%s\n%s\n%s\n", other, heap, buffer);
  fprintf(stdout, "%d\n", (int)strlen(buffer));
  free(heap);
  return 0;
}
