// After fork() the child is the same program: it reads and writes the program's objects of every kind (initialized,
// zero-filled, constant, thread-local), calls through a pointer kept in one, follows a pointer to the heap kept in
// another, and none of what it writes is seen by the parent. Then fork and exec, with an argument vector that is a
// static array.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static int initialized = 5;
static int zero_filled;
static const int table[] = { 10, 20, 30, 40 };
static const char *const literal = "a string literal";
static _Thread_local int for_this_thread = 7;
static int doubled(int x) { return 2 * x; }
static int (*through_a_pointer)(int) = doubled;
static char *on_the_heap;
static char *const arguments[] = { "/bin/echo", "said", "by", "echo", 0 };

// What the child finds, through a pipe to the parent.
static void in_the_child(int out) {
  char report[256];
  initialized += 1;
  zero_filled = 3;
  for_this_thread += 1;
  int n = snprintf(report, sizeof report, "%d %d %d %d %d %d %s %s", initialized, zero_filled, table[2], (int)strlen(literal), for_this_thread,
                   through_a_pointer(21), on_the_heap, arguments[1]);
  if (write(out, report, (size_t)n) != n) _exit(2);
  _exit(9);
}

int main(void) {
  on_the_heap = malloc(16);
  strcpy(on_the_heap, "kept");
  fflush(stdout);
  int ends[2];
  if (pipe(ends) != 0) return 1;
  pid_t child = fork();
  if (child == 0) {
    close(ends[0]);
    in_the_child(ends[1]);
  }
  close(ends[1]);
  char report[256] = "";
  ssize_t got = read(ends[0], report, sizeof report - 1);
  int status = 0;
  waitpid(child, &status, 0);
  printf("the child: %s (%d bytes), status %d\n", report, (int)got, WIFEXITED(status) ? WEXITSTATUS(status) : -WTERMSIG(status));
  printf("the parent: %d %d %d\n", initialized, zero_filled, for_this_thread);
  fflush(stdout);
  // A child of a child, to the same end.
  child = fork();
  if (child == 0) {
    pid_t grandchild = fork();
    if (grandchild == 0) _exit(initialized + table[0]);
    waitpid(grandchild, &status, 0);
    _exit(WEXITSTATUS(status) + 1);
  }
  waitpid(child, &status, 0);
  printf("through two forks: %d\n", WEXITSTATUS(status));
  fflush(stdout);
  child = fork();
  if (child == 0) {
    execv(arguments[0], arguments);
    _exit(127);
  }
  waitpid(child, &status, 0);
  printf("echo ended with %d\n", WEXITSTATUS(status));
  free(on_the_heap);
  return 0;
}
