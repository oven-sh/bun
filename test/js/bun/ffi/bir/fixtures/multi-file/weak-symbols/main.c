int printf(const char *, ...);
__attribute__((weak)) int maybe(int); extern int missing_object __attribute__((weak));
#pragma weak by_pragma
void by_pragma(void);
int weak_definition(void) __attribute__((weak));
int weak_definition(void) { return 1; }
extern int present;
int f(void) { int n = 0; if (maybe) n += maybe(1); if (&missing_object) n += missing_object; if (by_pragma) by_pragma(); return n + weak_definition(); }
int (*table[])(int) = { maybe };
int from_table(void) { return table[0] == 0 && &present != 0; }
void *frame(void) { return __builtin_frame_address(0); }
void *caller(void) { return __builtin_return_address(0); }

int main(void) {
  printf("%d\n", f());
  printf("%d\n", from_table());
  /* Nothing in the process defines the weak ones; the frame and the return address are real. */
  printf("%d %d\n", frame() != 0, caller() != 0);
  return 0;
}
