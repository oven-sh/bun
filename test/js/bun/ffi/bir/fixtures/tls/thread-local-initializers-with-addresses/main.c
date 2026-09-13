int printf(const char *, ...);
int global = 5; static int other = 6; int twice(int x) { return 2 * x; } extern int elsewhere;
_Thread_local int *to_global = &global;
static _Thread_local int *to_static = &other + 0;
_Thread_local int (*to_function)(int) = twice;
_Thread_local int counter = 40;
_Thread_local int *to_counter = &counter;
_Thread_local struct { int pad; int *p; char *text; } record = { 1, &counter, "tls" };
_Thread_local int *to_extern = &elsewhere;
int use(void) { *to_counter += 1; return *to_global + *to_static + to_function(10) + counter + *record.p + record.text[1] + (to_extern != 0); }

int main(void) {
  /* 5 + 6 + 20 + 41 + 41 + 'l' + 1 */
  printf("%d\n", use());
  return 0;
}
