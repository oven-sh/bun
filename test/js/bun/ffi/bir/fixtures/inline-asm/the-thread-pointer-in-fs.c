/* A segment override in extended asm. On x86-64 Linux the word at %fs:0 is the thread pointer itself, and
   thread-local objects sit below it. */
#include <stdio.h>

static void *thread_pointer(void) { void *self; __asm__("movq %%fs:0, %0" : "=r"(self)); return self; }

static _Thread_local int in_this_thread = 7;

int main(void) {
  void *self = thread_pointer();
  printf("fs %d %d\n", *(void **)self == self, (char *)&in_this_thread < (char *)self);
  return 0;
}
