// pthread_atfork: the handlers registered from C run around fork(), `prepare` ones last registered first and the
// others first registered first, in the parent and in the child, each in its own copy of the program's objects. (In
// glibc the function is in the part of the library that is linked into every program rather than looked up in it.)
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>

static int order[16], count;
static void prepare_first(void) { order[count++] = 1; }
static void prepare_second(void) { order[count++] = 2; }
static void in_parent_first(void) { order[count++] = 3; }
static void in_parent_second(void) { order[count++] = 4; }
static void in_child_first(void) { order[count++] = 5; }
static void in_child_second(void) { order[count++] = 6; }

static int as_a_number(void) {
  int number = 0;
  for (int i = 0; i < count; i++) number = number * 10 + order[i];
  return number;
}

int main(void) {
  int first = pthread_atfork(prepare_first, in_parent_first, in_child_first);
  int second = pthread_atfork(prepare_second, in_parent_second, 0);
  int third = pthread_atfork(0, 0, in_child_second);
  printf("%d %d %d\n", first, second, third);
  fflush(stdout);
  pid_t child = fork();
  if (child == 0) {
    // 2 1 5 6: what the child saw, as its exit status (one byte of it: 2156 % 251).
    _exit(as_a_number() % 251);
  }
  int status = 0;
  waitpid(child, &status, 0);
  printf("the parent ran %d, the child %d\n", as_a_number(), WIFEXITED(status) ? WEXITSTATUS(status) : -1);
  // A second fork runs them all again.
  child = fork();
  if (child == 0) _exit(count);
  waitpid(child, &status, 0);
  printf("%d handlers ran in the parent by now, %d in the second child\n", count, WEXITSTATUS(status));
  return 0;
}
