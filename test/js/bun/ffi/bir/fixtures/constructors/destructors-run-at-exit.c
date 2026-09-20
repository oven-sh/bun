/* After main returns (or exit is called): the atexit handlers, then the destructors, those
   without a priority first and then from the highest priority number down. */
#include <stdio.h>
#include <stdlib.h>
static void __attribute__((constructor)) first(void) { printf("constructor\n"); }
static void __attribute__((destructor)) plain(void) { printf("destructor\n"); }
static void __attribute__((destructor(200))) late(void) { printf("destructor 200\n"); }
static void __attribute__((destructor(101))) last(void) { printf("destructor 101\n"); }
static void bye(void) { printf("atexit\n"); }
int main(void) { atexit(bye); printf("main\n"); return 0; }
