// What a C file hands to the process outlives every reference JavaScript has to it: a handler its constructor gives
// to atexit, a handler it gives to signal, the address of one of its statics. The file exports nothing the program
// keeps, so nothing but the process itself keeps it loaded.
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>

static const char *message = "the exit handler ran";
static int signals;
static void at_exit(void) { printf("%s, after %d signals\n", message, signals); }
static void on_signal(int number) { (void)number; signals++; }
__attribute__((constructor)) static void set_up(void) {
  atexit(at_exit);
  signal(SIGUSR1, on_signal);
  puts("the constructor ran");
}
int *address_of_the_count(void) { return &signals; }
