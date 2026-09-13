// C11 6.7.1: typedef, extern, static, _Thread_local, auto and register, in every place each may appear.
#include <stdio.h>

typedef int integer, *pointer_to_integer, array_of_three[3];
extern int defined_below;
extern int function_below(int);
static int file_static = 1;
static int static_function(int x) { return x + file_static; }
_Thread_local int thread_external = 2;
static _Thread_local int thread_static = 3;
extern _Thread_local int thread_declared;
_Thread_local int thread_declared = 4;
// A storage-class specifier may come anywhere among the declaration specifiers.
int static odd_order = 5;
const static int long unsigned very_odd_order = 6;
int typedef late_typedef;

static int counter(void) {
  static int calls;                  // static in a block: one object, zero-initialized, persistent
  static _Thread_local int per_thread_calls = 10;
  return ++calls * 100 + ++per_thread_calls;
}

static int registers(register int a, register int b) {
  register int sum = a + b;          // a hint; the only effect is that & is not allowed on it
  register int array[2] = {1, 2};    // (an array declared register can only be measured)
  auto int automatic = sum * 2;      // auto is what a block-scope object without a specifier already is
  for (register int i = 0; i < 2; i++) automatic += i;
  return automatic + (int)sizeof array / (int)sizeof(int);
}

int main(void) {
  integer i = 7; pointer_to_integer p = &i; array_of_three a = {1, 2, 3}; late_typedef l = 8;
  typedef char block_scope_typedef[2];
  block_scope_typedef b = "x";
  printf("%d %d %d %d %d\n", *p, a[2], l, (int)sizeof b, (int)sizeof(array_of_three) / (int)sizeof(integer));
  extern int defined_below;          // extern in a block
  extern int function_below(int);
  printf("%d %d %d %d\n", defined_below, function_below(1), static_function(1), file_static);
  printf("%d %d %d %d %llu\n", thread_external, thread_static, thread_declared, odd_order, (unsigned long long)very_odd_order);
  counter();
  printf("%d %d\n", counter(), registers(3, 4));
  return 0;
}
int defined_below = 40;
int function_below(int x) { return x + defined_below; }
